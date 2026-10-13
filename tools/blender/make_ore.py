"""Ore rocks for the RTS: 8 fractured low-poly rocks + Ore_Material, rendered as game sprites.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P make_ore.py
Saves ore.blend and writes game/assets/ore.{png,json} (Phaser JSON Hash atlas, one frame per rock,
per-frame ground anchors in meta.anchors) plus ore_lineup.png for a close look.

Scale, camera and lighting match the refinery sprites (render_sprites.py / meshy_refinery.blend):
one tile = 0.4759 units = 128 px at 2x, camera 45 deg yaw / 30 deg down, same sun and world.
"""
import json
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector, noise

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(OUT_DIR, "..", "..", "apps", "game", "public", "assets", "sprites")   # the game reads sprites from here
FRAMES_DIR = os.path.join(OUT_DIR, "frames")   # raw per-frame renders (gitignored)
os.makedirs(FRAMES_DIR, exist_ok=True)

TILE = 0.4759                     # world units per tile (from the refinery footprint)
PPU = 128 / (TILE * math.sqrt(2)) # pixels per unit at 2x, same as the refinery
ROCK_UNIT = 0.13                  # world size of a "radius 1" rock: rocks span ~0.3-0.65 tiles

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection

# --- Rocks ------------------------------------------------------------------------
# (radii x, y, z), number of fracture cuts, tilt (deg x, y, z)
ROCKS = [
    ((1.00, 0.85, 0.70), 5, (0, 0, 10)),     # chunky boulder
    ((1.45, 0.60, 0.55), 5, (0, 8, 35)),     # long ridge
    ((0.60, 0.55, 1.25), 6, (12, 0, 20)),    # tall shard
    ((1.10, 0.95, 0.40), 4, (5, -4, 60)),    # flat slab
    ((1.00, 0.70, 0.85), 6, (0, 18, -30)),   # wedge
    ((0.60, 0.50, 0.48), 4, (0, 0, 45)),     # small nugget
    ((0.85, 0.50, 1.05), 5, (-20, 10, 75)),  # leaning shard
    ((1.25, 1.00, 0.62), 6, (0, 0, -15)),    # wide lump
]


def make_rock(index, radii, cuts, tilt):
    rng = random.Random(1000 + index)
    offset = Vector((rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50)))
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:                                   # lumpy, irregular silhouette
        n = v.co.normalized()
        v.co = n * (1.0 + 0.28 * noise.noise(n * 1.6 + offset) + rng.uniform(-0.04, 0.04))
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))

    def cut(normal, keep):
        """Slice off everything beyond keep * extent along normal and cap it flat."""
        normal = normal.normalized()
        extent = max(v.co.dot(normal) for v in bm.verts)
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                               plane_co=normal * extent * keep, plane_no=normal, clear_outer=True)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)

    for _ in range(cuts):                                # fracture planes: flat broken faces
        a = rng.uniform(0, 2 * math.pi)
        z = rng.uniform(-0.15, 0.75)
        cut(Vector((math.cos(a), math.sin(a), z)), rng.uniform(0.55, 0.82))

    bmesh.ops.transform(bm, matrix=Euler([math.radians(t) for t in tilt]).to_matrix().to_4x4(),
                        verts=bm.verts)
    zmin = min(v.co.z for v in bm.verts)
    zmax = max(v.co.z for v in bm.verts)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],    # flat base
                           plane_co=(0, 0, zmin + 0.18 * (zmax - zmin)), plane_no=(0, 0, -1),
                           clear_outer=True)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.005)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # sit on the ground at the origin, scale to world size
    zmin = min(v.co.z for v in bm.verts)
    cx = sum(v.co.x for v in bm.verts) / len(bm.verts)
    cy = sum(v.co.y for v in bm.verts) / len(bm.verts)
    bmesh.ops.transform(bm, matrix=Matrix.Scale(ROCK_UNIT, 4) @ Matrix.Translation((-cx, -cy, -zmin)),
                        verts=bm.verts)
    name = f"OreRock_{index + 1:02d}"
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False                          # faceted, angular shading
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    # Decimate to a per-rock budget inside 100-500 tris; collapse keeps the fractured planes
    target = rng.randint(180, 320)
    dec = obj.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = min(1.0, target / len(mesh.polygons))
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.clear()
    obj.data = baked
    bpy.data.meshes.remove(mesh)
    baked.name = name
    bm = bmesh.new()
    bm.from_mesh(baked)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(baked)
    bm.free()
    for poly in baked.polygons:
        poly.use_smooth = False
    return obj


rocks = [make_rock(i, *spec) for i, spec in enumerate(ROCKS)]
for obj in rocks:
    print(f"{obj.name}: {len(obj.data.polygons)} tris, {tuple(round(d, 3) for d in obj.dimensions)} m")

# --- Ore_Material -------------------------------------------------------------------
mat = bpy.data.materials.new("Ore_Material")
mat.use_nodes = True
nt = mat.node_tree
nodes, links = nt.nodes, nt.links
bsdf = nodes["Principled BSDF"]


def node(kind, **inputs):
    n = nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def link(a, b):
    links.new(a, b)


def ramp(src, stops, interpolation="LINEAR"):
    """ColorRamp from (position, rgba) stops."""
    r = nodes.new("ShaderNodeValToRGB")
    r.color_ramp.interpolation = interpolation
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0]
    els[1].position, els[1].color = stops[-1]
    for pos, c in stops[1:-1]:
        e = els.new(pos)
        e.color = c
    link(src, r.inputs["Fac"])
    return r


def remap(src, a, b, c=0.0, d=1.0):
    m = node("ShaderNodeMapRange", **{"From Min": a, "From Max": b, "To Min": c, "To Max": d})
    m.clamp = True
    link(src, m.inputs["Value"])
    return m.outputs["Result"]


def math_node(op, a, b):
    m = nodes.new("ShaderNodeMath")
    m.operation = op
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            link(v, m.inputs[i])
    return m.outputs[0]


# Object-space coordinates normalised to rock size, distorted so patterns break up
tex = nodes.new("ShaderNodeTexCoord")
unit = nodes.new("ShaderNodeVectorMath")
unit.operation = "SCALE"
unit.inputs["Scale"].default_value = 1.0 / ROCK_UNIT
link(tex.outputs["Object"], unit.inputs[0])
warp = node("ShaderNodeTexNoise", Scale=1.2, Detail=3.0)
link(unit.outputs[0], warp.inputs["Vector"])
warp_amt = nodes.new("ShaderNodeVectorMath")
warp_amt.operation = "SCALE"
warp_amt.inputs["Scale"].default_value = 0.35
link(warp.outputs["Color"], warp_amt.inputs[0])
coords = nodes.new("ShaderNodeVectorMath")
coords.operation = "ADD"
link(unit.outputs[0], coords.inputs[0])
link(warp_amt.outputs[0], coords.inputs[1])
P = coords.outputs[0]

# Fractured streaks: Voronoi cell edges, wide, and broken into fragments by a mask noise
vor = node("ShaderNodeTexVoronoi", Scale=1.1)
vor.feature = "DISTANCE_TO_EDGE"
link(P, vor.inputs["Vector"])
streaks = remap(vor.outputs["Distance"], 0.03, 0.11, 1.0, 0.0)
breakup = node("ShaderNodeTexNoise", Scale=0.9, Detail=2.0)
link(P, breakup.inputs["Vector"])
streaks = math_node("MULTIPLY", streaks, remap(breakup.outputs["Fac"], 0.42, 0.52))
# Large mineral patches: low-frequency noise through a sharp ColorRamp threshold
patch_noise = node("ShaderNodeTexNoise", Scale=0.75, Detail=4.0, Roughness=0.55)
link(P, patch_noise.inputs["Vector"])
patches = ramp(patch_noise.outputs["Fac"], [(0.56, (0, 0, 0, 1)), (0.6, (1, 1, 1, 1))])
vein = math_node("MAXIMUM", streaks, patches.outputs["Color"])

# Rock base: dark charcoal with subtle variation; veins: warm yellow-gold
fine = node("ShaderNodeTexNoise", Scale=6.0, Detail=8.0, Roughness=0.6)
link(P, fine.inputs["Vector"])
rock_col = ramp(fine.outputs["Fac"], [(0.3, (0.022, 0.021, 0.02, 1)), (0.7, (0.075, 0.07, 0.064, 1))])
gold_col = ramp(patch_noise.outputs["Fac"], [(0.45, (0.42, 0.2, 0.015, 1)), (0.75, (0.85, 0.48, 0.05, 1))])
color = nodes.new("ShaderNodeMix")
color.data_type = "RGBA"
link(vein, color.inputs[0])
link(rock_col.outputs["Color"], color.inputs[6])
link(gold_col.outputs["Color"], color.inputs[7])
link(color.outputs[2], bsdf.inputs["Base Color"])

rough_rock = remap(fine.outputs["Fac"], 0.3, 0.7, 0.7, 0.82)
rough = nodes.new("ShaderNodeMix")
rough.data_type = "FLOAT"
link(vein, rough.inputs[0])
link(rough_rock, rough.inputs[2])
rough.inputs[3].default_value = 0.35
link(rough.outputs[0], bsdf.inputs["Roughness"])
link(math_node("MULTIPLY", vein, 0.65), bsdf.inputs["Metallic"])
link(gold_col.outputs["Color"], bsdf.inputs["Emission Color"])
link(math_node("MULTIPLY", vein, 0.25), bsdf.inputs["Emission Strength"])   # very subtle

# Rocky relief; veins sit slightly recessed in the fractures
height = math_node("ADD", fine.outputs["Fac"], math_node("MULTIPLY", vein, -0.35))
bump = node("ShaderNodeBump", Strength=0.45, Distance=0.02)
link(height, bump.inputs["Height"])
link(bump.outputs["Normal"], bsdf.inputs["Normal"])

for obj in rocks:
    obj.data.materials.append(mat)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "ore.blend"))

# --- Lighting and render setup matching the refinery sprites -------------------------
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
col.objects.link(sun)
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
scene.world = world

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type == "METAL"
scene.cycles.device = "GPU"
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100

bpy.ops.mesh.primitive_plane_add(size=4)
catcher = bpy.context.active_object
catcher.name = "ShadowCatcher"
catcher.is_shadow_catcher = True

cam = bpy.data.objects.new("Camera_Sprite", bpy.data.cameras.new("Camera_Sprite"))
col.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.sensor_fit = "HORIZONTAL"
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
rot = cam.rotation_euler.to_matrix()
RIGHT, UP, FWD = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, -1))
light_dir = (sun.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()


def frame_points(points, anchor, pad=6):
    us, vs = [p.dot(RIGHT) for p in points], [p.dot(UP) for p in points]
    u0, v0 = min(us) - pad / PPU, min(vs) - pad / PPU
    w = math.ceil((max(us) - min(us)) * PPU) + 2 * pad
    h = math.ceil((max(vs) - min(vs)) * PPU) + 2 * pad
    u1, v1 = u0 + w / PPU, v0 + h / PPU
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam.data.ortho_scale = w / PPU
    cam.location = RIGHT * (u0 + u1) / 2 + UP * (v0 + v1) / 2 - FWD * 30
    return w, h, (round((anchor.dot(RIGHT) - u0) * PPU, 1), round((v1 - anchor.dot(UP)) * PPU, 1))


def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


# --- Render each rock on its own, then shelf-pack into one atlas -----------------------
sprites = []
for obj in rocks:
    for other in rocks:
        other.hide_render = other is not obj
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    tips = [p + light_dir * (p.z / -light_dir.z) for p in corners if p.z > 1e-4]
    w, h, anchor = frame_points(corners + tips, Vector((0, 0, 0)))
    path = os.path.join(FRAMES_DIR, f"{obj.name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sprites.append((obj.name, load_rgba(path), anchor))

sheet_w = sum(px.shape[1] for _, px, _ in sprites) + 2 * len(sprites)
sheet_h = max(px.shape[0] for _, px, _ in sprites)
sheet = np.zeros((sheet_h, sheet_w, 4), dtype=np.float32)
frames, anchors, x = {}, {}, 0
for i, (name, px, anchor) in enumerate(sprites):
    h, w = px.shape[:2]
    sheet[sheet_h - h:sheet_h, x:x + w] = px            # bottom-up storage: top-aligned row
    key = f"ore_{i + 1:02d}"
    frames[key] = {"frame": {"x": x, "y": 0, "w": w, "h": h}, "rotated": False, "trimmed": False,
                   "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h}}
    anchors[key] = {"x": anchor[0], "y": anchor[1]}
    x += w + 2
img = bpy.data.images.new("ore_sheet", sheet_w, sheet_h, alpha=True)
img.pixels.foreach_set(sheet.ravel())
img.filepath_raw = os.path.join(ASSETS, "ore.png")
img.file_format = "PNG"
img.save()
with open(os.path.join(ASSETS, "ore.json"), "w") as f:
    json.dump({"frames": frames, "meta": {"image": "ore.png", "size": {"w": sheet_w, "h": sheet_h},
                                          "scale": "1", "anchors": anchors, "tile_px": 128}}, f, indent=1)
print(f"PACKED ore: {len(sprites)} rocks -> {sheet_w}x{sheet_h}")

# --- Close-up lineup for inspection (4x the 2x sprite resolution) ----------------------
for i, obj in enumerate(rocks):
    obj.hide_render = False
    obj.location = ((i % 4) * 0.42 - 0.63 + (i // 4) * 0.21, (i // 4) * -0.42 + (i % 4) * 0.0, 0)
bpy.context.view_layer.update()
pts = [o.matrix_world @ Vector(c) for o in rocks for c in o.bound_box]
w, h, _ = frame_points(pts, Vector((0, 0, 0)), pad=20)
scale = 4
scene.render.resolution_x, scene.render.resolution_y = w * scale, h * scale
catcher.is_shadow_catcher = False
catcher.data.materials.append(bpy.data.materials.new("Sand"))
catcher.data.materials[0].diffuse_color = (0.35, 0.3, 0.22, 1)
catcher.data.materials[0].use_nodes = True
catcher.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.3, 0.22, 1)
scene.render.film_transparent = False
scene.render.filepath = os.path.join(OUT_DIR, "ore_lineup.png")
bpy.ops.render.render(write_still=True)
