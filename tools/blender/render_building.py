"""Render game sprites for one of the Meshy base buildings (power plant, silo, barracks, radar).

Run: /Applications/Blender.app/Contents/MacOS/Blender -b --disable-autoexec <meshy .blend> \
        -P render_building.py -- <power|silo|barracks|radar>
Writes game/assets/b_<name>.{png,json} (body layer) and, for the power plant, b_power_steam.{png,json}.
The source .blend is never saved.

Conventions match the refinery / harvester sprites: camera 45 deg yaw / 30 deg down, same sun
and world, art at 2x (one tile = 128 px wide), transparent background with the ground shadow
baked in, meta.anchor = pixel of the footprint centre on the ground.

Animations:
  radar - the dish is split from the fused Meshy mesh and spins: 24-frame loop
  power - Mantaflow steam from the four dome tops, smoke-only layer (building held out): 32-frame loop
  all   - meta.lights lists antenna tips in sprite pixels so the game can blink beacons there
Feature positions were found by ray-casting each model (see the BUILDINGS table).
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

NAME = sys.argv[sys.argv.index("--") + 1]
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(OUT_DIR, "..", "..", "apps", "game", "public", "assets", "sprites")   # the game reads sprites from here
FRAMES_DIR = os.path.join(OUT_DIR, "frames")   # raw per-frame renders (gitignored)
os.makedirs(FRAMES_DIR, exist_ok=True)

BUILDINGS = {
    "power": {"size": 3, "lights": [(-0.007, 0.089, 0.484)],
              # centres of the four tank caps (region-grown from a top-down height map)
              "steam": [(-0.58, -0.13, 0.115), (0.61, -0.10, 0.13), (-0.33, 0.41, 0.215), (0.41, 0.43, 0.19)]},
    "silo": {"size": 2, "lights": [(-0.006, 0.115, 0.619), (-0.156, 0.46, 0.298)]},
    "barracks": {"size": 3, "lights": [(0.449, 0.174, 0.611), (0.584, 0.309, 0.436), (0.389, 0.429, 0.405)]},
    "radar": {"size": 3, "lights": [(0.518, 0.553, 0.538), (0.563, 0.268, 0.499), (-0.787, 0.403, 0.248), (-0.502, 0.403, 0.224)],
              # dish: faces above the gap at z -0.055 inside this ellipse (largest connected piece)
              "dish": {"cx": 0.22, "cy": 0.30, "rx": 0.40, "ry": 0.46, "zmin": -0.055,
                       "pivot": (0.0, 0.16)}},   # centre of the mount ring under the dish
}
B = BUILDINGS[NAME]
DIRS_FRAMES = {"radar": 24}

scene = bpy.context.scene
col = scene.collection
body = [o for o in bpy.data.objects if o.type == "MESH"][0]
bb = [body.matrix_world @ Vector(c) for c in body.bound_box]
lo = Vector([min(v[i] for v in bb) for i in range(3)])
hi = Vector([max(v[i] for v in bb) for i in range(3)])
TILE = max(hi.x - lo.x, hi.y - lo.y) / (B["size"] * 0.95)    # model fills ~95% of its footprint
PPU = 128 / (TILE * math.sqrt(2))
ANCHOR = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
print(f"{NAME}: TILE={TILE:.4f} PPU={PPU:.1f}")


# --- Radar: split the dish out so it can spin ------------------------------------------------
def split_dish(d):
    me = body.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    ls = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", ls)
    tri_loops = ls[:, None] + np.arange(3)
    tris = lv[tri_loops]
    inside = (((co[:, 0] - d["cx"]) / d["rx"]) ** 2 + ((co[:, 1] - d["cy"]) / d["ry"]) ** 2 < 1) & (co[:, 2] > d["zmin"])
    cand = np.nonzero(inside[tris].all(axis=1))[0]
    # largest connected component among candidate faces (union-find on shared vertices)
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for f in cand:
        a, b, c = tris[f]
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    roots = np.array([find(tris[f][0]) for f in cand])
    vals, counts = np.unique(roots, return_counts=True)
    faces = cand[roots == vals[np.argmax(counts)]]
    used = np.unique(tris[faces])
    # pivot: vertical axis through the mount the dish sits on
    pts = co[used]
    pivot = Vector((d["pivot"][0], d["pivot"][1], pts[:, 2].min()))
    remap = np.full(len(co), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers[0].data.foreach_get("uv", uv)
    dm = bpy.data.meshes.new("Dish")
    dm.from_pydata((pts - np.array(pivot)).tolist(), [], remap[tris[faces]].tolist())
    dm.uv_layers.new(name=me.uv_layers[0].name).data.foreach_set("uv", uv.reshape(-1, 2)[tri_loops[faces]].ravel())
    dm.materials.append(me.materials[0])
    dm.shade_smooth()
    dish = bpy.data.objects.new("Dish", dm)
    col.objects.link(dish)
    dish.location = pivot
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in faces], context="FACES")
    bm.to_mesh(me)
    bm.free()
    print(f"dish: {len(faces)} faces, pivot {tuple(round(v, 3) for v in pivot)}")
    return dish


dish = split_dish(B["dish"]) if "dish" in B else None

# --- Lighting and render setup (same as the refinery sprites) --------------------------------
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
col.objects.link(sun)
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
scene.world = scene.world or bpy.data.worlds.new("World")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.55, 0.6, 0.68, 1.0)
bg.inputs["Strength"].default_value = 0.8

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type == "METAL"
scene.cycles.device = "GPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.use_persistent_data = True
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100

bpy.ops.mesh.primitive_plane_add(size=12, location=(ANCHOR.x, ANCHOR.y, lo.z + 0.001))
catcher = bpy.context.active_object
catcher.is_shadow_catcher = True

cam = bpy.data.objects.new("Camera_Sprite", bpy.data.cameras.new("Camera_Sprite"))
col.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.sensor_fit = "HORIZONTAL"
cam.data.clip_end = 200
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
rot = cam.rotation_euler.to_matrix()
RIGHT, UP, FWD = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, -1))
light_dir = (sun.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()


def frame_points(points, pad=10):
    us, vs = [p.dot(RIGHT) for p in points], [p.dot(UP) for p in points]
    u0, v0 = min(us) - pad / PPU, min(vs) - pad / PPU
    w = math.ceil((max(us) - min(us)) * PPU) + 2 * pad
    h = math.ceil((max(vs) - min(vs)) * PPU) + 2 * pad
    u1, v1 = u0 + w / PPU, v0 + h / PPU
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam.data.ortho_scale = w / PPU
    cam.location = RIGHT * (u0 + u1) / 2 + UP * (v0 + v1) / 2 - FWD * 60
    px = lambda p: (round((p.dot(RIGHT) - u0) * PPU, 1), round((v1 - p.dot(UP)) * PPU, 1))
    return w, h, px


def render_frames(prefix, frames):
    paths = []
    for f in frames:
        scene.frame_set(f)
        path = os.path.join(FRAMES_DIR, f"{prefix}_{f:03d}.png")
        scene.render.filepath = path
        for attempt in range(4):                    # Metal sometimes drops textures: retry black frames
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(path)
            px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            px = px.reshape(-1, 4)
            opaque = px[:, 3] > 0.9
            if prefix.endswith("steam") or (opaque.any() and px[opaque, :3].mean() > 0.05):
                break
            print(f"BLACK FRAME {prefix} {f}, re-rendering")
            scene.render.use_persistent_data = False
        scene.render.use_persistent_data = True
        paths.append(path)
    return paths


def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def pack(key, frames, w, h, meta, cols):
    rows = math.ceil(len(frames) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    entries = {}
    for i, px in enumerate(frames):
        c, r = i % cols, i // cols
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = px
        entries[f"{key}_{i:02d}"] = {"frame": {"x": c * w, "y": r * h, "w": w, "h": h}, "rotated": False,
                                     "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
                                     "sourceSize": {"w": w, "h": h}}
    img = bpy.data.images.new(key, cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = os.path.join(ASSETS, f"{key}.png")
    img.file_format = "PNG"
    img.save()
    meta.update({"image": f"{key}.png", "size": {"w": cols * w, "h": rows * h}, "scale": "1",
                 "frames": len(frames), "footprint_tiles": B["size"], "tile_px": 128})
    with open(os.path.join(ASSETS, f"{key}.json"), "w") as fh:
        json.dump({"frames": entries, "meta": meta}, fh, indent=1)
    print(f"PACKED {key}: {len(frames)} frames {w}x{h} -> {cols * w}x{rows * h}")


# --- Body layer ---------------------------------------------------------------------------------
top = [Vector((x, y, hi.z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y)]
shadow_tips = [p + light_dir * ((p.z - lo.z) / -light_dir.z) for p in top]
w, h, px = frame_points(bb + shadow_tips)
n_frames = DIRS_FRAMES.get(NAME, 1)
if dish:
    dish.animation_data_create()
    drv = dish.driver_add("rotation_euler", 2).driver
    drv.type = "SCRIPTED"
    drv.expression = f"frame * {2 * math.pi / n_frames:.6f}"
paths = render_frames(f"b_{NAME}", range(n_frames))
meta = {"anchor": dict(zip("xy", px(ANCHOR))), "fps": 12, "loop": n_frames > 1,
        "lights": [dict(zip("xy", px(Vector(p)))) for p in B["lights"]]}
pack(f"b_{NAME}", [load_rgba(p) for p in paths], w, h, meta, cols=min(n_frames, 6))

# --- Power plant: steam layer -----------------------------------------------------------------
if "steam" in B:
    FR = (1, 120)
    dlo = Vector((lo.x - 0.1, lo.y - 0.1, 0.1))
    dhi = Vector((hi.x + 0.1, hi.y + 0.1, hi.z + 1.3))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(dlo + dhi) / 2)
    domain = bpy.context.active_object
    domain.scale = dhi - dlo
    bpy.ops.object.transform_apply(scale=True)
    ds = domain.modifiers.new("Fluid", "FLUID")
    ds.fluid_type = "DOMAIN"
    d = ds.domain_settings
    d.domain_type = "GAS"
    d.resolution_max = 110
    d.use_adaptive_domain = True
    d.alpha, d.beta, d.vorticity = 0.3, 1.2, 0.35
    d.use_dissolve_smoke = True
    d.dissolve_speed = 45
    d.cache_type = "ALL"
    d.cache_directory = os.path.join(OUT_DIR, "steam_cache_power")
    d.cache_frame_start, d.cache_frame_end = FR
    mat = bpy.data.materials.new("Steam")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 6.0
    vol.inputs["Color"].default_value = (0.92, 0.93, 0.95, 1)
    nt.links.new(vol.outputs["Volume"], nt.nodes["Material Output"].inputs["Volume"])
    domain.data.materials.append(mat)
    for i, (x, y, z) in enumerate(B["steam"]):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.07, depth=0.03, vertices=16, location=(x, y, z + 0.02))
        em = bpy.context.active_object
        em.hide_render = True
        fm = em.modifiers.new("Fluid", "FLUID")
        fm.fluid_type = "FLOW"
        f = fm.flow_settings
        f.flow_type, f.flow_behavior, f.flow_source = "SMOKE", "INFLOW", "MESH"
        f.smoke_color = (0.95, 0.95, 0.97)
        f.density, f.temperature = 0.9, 1.2
        f.use_initial_velocity = True
        f.velocity_coord = (0, 0, 0.5)
    with bpy.context.temp_override(object=domain, active_object=domain, selected_objects=[domain]):
        bpy.ops.fluid.bake_all()
    dbb = [domain.matrix_world @ Vector(c) for c in domain.bound_box]
    sw, sh, spx = frame_points(dbb + bb)
    catcher.hide_render = True
    body.is_holdout = True
    steam = [load_rgba(p) for p in render_frames("b_power_steam", range(73, 121))]
    LOOP, FADE = 32, 16                             # crossfade the tail into the head for a seamless loop
    looped = []
    for i in range(LOOP):
        a = steam[i]
        if i < FADE:
            t = i / FADE
            b = steam[i + LOOP]
            pa, pb = a[..., :3] * a[..., 3:], b[..., :3] * b[..., 3:]
            alpha = b[..., 3:] * (1 - t) + a[..., 3:] * t
            a = np.concatenate([(pb * (1 - t) + pa * t) / np.maximum(alpha, 1e-6), alpha], axis=-1)
        looped.append(a)
    pack("b_power_steam", looped, sw, sh, {"anchor": dict(zip("xy", spx(ANCHOR))), "fps": 12, "loop": True}, cols=8)
