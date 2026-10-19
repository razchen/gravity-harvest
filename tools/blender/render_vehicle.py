"""Render a vehicle's game sprites from a Tripo model: DIRS driving directions, plus a big card view.

Run from the repo root, for one vehicle of tools/blender/vehicles.json (or all of them with no id):
    Blender -b --factory-startup -P tools/blender/render_vehicle.py -- ram
then pack them into the game's atlases (and its build card):
    python3 tools/sprites/pack_vehicles.py

The model is scaled so its long side is `length_tiles` long (the harvester is 1.5) and its nose points at world angle
d * 360 / DIRS degrees for direction d, counter-clockwise from +X seen from above, like the units. The nose is taken
to be along the long side: -Y when that's Y, +X when it's X; `nose_deg` (the angle the model's nose points at)
overrides it. Its wheels (round parts near the ground) are found and spun: `wheel_<d>_<f>.png` are only the wheels,
WHEEL_FRAMES steps of a turn, drawn over the vehicle while it drives (`wheels: false` in its config turns that off). Writes to tools/blender/frames/vehicles/<id>/:
`dir_<d>.png` (RES x the art scale) and `card.png` (facing the camera, CARD_SCALE x bigger), plus frames.json (canvas
size and anchor). Camera, sun and shadow catcher match the buildings.

A vehicle with `rig` in its config is loaded from that .blend in art/models/tripo/ instead (the Tripo model with
empties added): each `wheel_<n>` empty is a wheel's axle with its parts under it, spun by its own animation (a whole
turn forwards over the scene's frame range), and a `turret` empty is a head that turns on its own: then `hull_<d>.png`
is the vehicle without it and `turret_<t>.png` the head alone in TURRET_DIRECTIONS directions, its pivot on the
anchor; frames.json says where the pivot sits over each hull direction and where the gun fires from.

A hovering unit (`hover: {"height": <tiles>, "glow": [r, g, b]}` in its config, its model in `model`, a path under
art/models/tripo/) floats that high over the ground: `dir_<d>.png` is the unit alone and `shadow_<d>.png` its shadow
alone, both on the same canvas, so the game can bob it over its shadow. Its lights are the model's own accent colours
(the saturated panels) made to glow, strongest along its underside, with a light of `glow` under it. `muzzle` (a list of
points, each [forward, left, up] as fractions of the model's length, width and height from its centre on the ground)
are where its guns fire from: frames.json gives them in each direction.

A rig's `hide` leaves out the parts under those of its handles (`harvester_empty` is the harvester without its ore).
A rig's `clips` (`{"lay_mine": {"frames": 12}, "scan": {"frames": 24, "loop": true}}`) are animations in its .blend
between the timeline markers `<name>` and `<name>_end`: `clip_<name>_<d>_<f>.png` are the whole vehicle in direction d
(on the same canvas as dir_*), `frames` even steps through that range. One that plays once takes in both its ends; a
`loop` stops a step short of the end, which is its start again. frames.json gives each its frames, fps and loop.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

CONFIG = json.load(open(os.path.join("tools", "blender", "vehicles.json")))
# one file per unit as well (tools/blender/units/<id>.json, the hovering units'), the same as an entry in vehicles.json
UNITS_DIR = os.path.join("tools", "blender", "units")
if os.path.isdir(UNITS_DIR):
    for f in sorted(os.listdir(UNITS_DIR)):
        if f.endswith(".json"):
            CONFIG[f[:-5]] = json.load(open(os.path.join(UNITS_DIR, f)))
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
WANT = args[0] if args else None
# STILL=<direction>,<scale>: render only that direction, scale x bigger, with no shadow (tools/sprites/key_video.py)
STILL = tuple(int(n) for n in os.environ["STILL"].split(",")) if os.environ.get("STILL") else None

TILE_PX = 128
RES = 1.5
DIRS = 16
CARD_DIR = 13                                   # nose to the bottom left (towards the camera, a little left)
WHEEL_FRAMES = 6
TURRET_DIRECTIONS = 32                          # as the defences' heads (the sim aims in as many)
HOVER_SUN_DEG = 18                              # a hovering unit's shadow: the sun this far off overhead
CARD_SCALE = 8                                  # the card view doubles as the dev pages' high-res picture


def setup_scene():
    sc = bpy.context.scene
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.world = bpy.data.worlds.new("World")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1.0)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = dev.type == "METAL"
    sc.cycles.device = "GPU"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.use_persistent_data = True
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "AgX"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    return sc, sun


def glow(parts, hover, lift, h, length):
    """A hovering unit's lights: its accent colours (saturated, bright texels) glow, most along its underside and
    least on top; and a light of the glow colour under it, lighting its belly and lower sides."""
    r, g, b = hover["glow"]
    strength = hover.get("strength", 2.5)
    for mat in {s.material for o in parts for s in o.material_slots if s.material}:
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf or not bsdf.inputs["Base Color"].is_linked:
            continue
        base = bsdf.inputs["Base Color"].links[0].from_socket
        hsv = nt.nodes.new("ShaderNodeSeparateColor")
        hsv.mode = "HSV"
        nt.links.new(base, hsv.inputs[0])
        # the accent mask: saturated and not dark
        sat = nt.nodes.new("ShaderNodeMapRange")
        sat.inputs["From Min"].default_value, sat.inputs["From Max"].default_value = 0.55, 0.85
        nt.links.new(hsv.outputs[1], sat.inputs["Value"])
        val = nt.nodes.new("ShaderNodeMapRange")
        val.inputs["From Min"].default_value, val.inputs["From Max"].default_value = 0.3, 0.7
        nt.links.new(hsv.outputs[2], val.inputs["Value"])
        mask = nt.nodes.new("ShaderNodeMath")
        mask.operation = "MULTIPLY"
        nt.links.new(sat.outputs[0], mask.inputs[0])
        nt.links.new(val.outputs[0], mask.inputs[1])
        # along the underside: full at its bottom, almost none from 30 % of its height up
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        z = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(geo.outputs["Position"], z.inputs[0])
        low = nt.nodes.new("ShaderNodeMapRange")
        low.inputs["From Min"].default_value, low.inputs["From Max"].default_value = lift + 0.3 * h, lift
        low.inputs["To Min"].default_value, low.inputs["To Max"].default_value = 0.06, 1.0
        nt.links.new(z.outputs[2], low.inputs["Value"])
        k = nt.nodes.new("ShaderNodeMath")
        k.operation = "MULTIPLY"
        nt.links.new(mask.outputs[0], k.inputs[0])
        nt.links.new(low.outputs[0], k.inputs[1])
        nt.links.new(base, bsdf.inputs["Emission Color"])
        nt.links.new(k.outputs[0], bsdf.inputs["Emission Strength"])
        k2 = nt.nodes.new("ShaderNodeMath")
        k2.operation = "MULTIPLY"
        k2.inputs[1].default_value = strength
        nt.links.new(k.outputs[0], k2.inputs[0])
        nt.links.new(k2.outputs[0], bsdf.inputs["Emission Strength"])
    light = bpy.data.objects.new("Glow", bpy.data.lights.new("Glow", "POINT"))
    bpy.context.scene.collection.objects.link(light)
    light.data.color = (r, g, b)
    light.data.energy = hover.get("light", 40.0) * length ** 2
    light.data.shadow_soft_size = 0.3 * length
    light.location = (0, 0, lift * 0.35)
    return light


def render_vehicle(vid, cfg):
    if cfg.get("rig"):
        bpy.ops.wm.open_mainfile(filepath=os.path.join("art", "models", "tripo", cfg["rig"]), load_ui=False)
        for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
            bpy.data.objects.remove(o)
        sc, sun = setup_scene()
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc, sun = setup_scene()
        bpy.ops.import_scene.gltf(filepath=os.path.join("art", "models", "tripo", cfg.get("model", f"{vid}.glb")))
    # `hide`: rig handles whose parts are left out of the renders (the harvester's `ore`: it renders empty); still
    # measured, so its canvas and anchor are the full one's
    for h in cfg.get("hide", []):
        for o in bpy.data.objects[h].children_recursive:
            o.hide_render = True
    parts = [o for o in bpy.data.objects if o.type == "MESH"]
    rig_wheels = sorted((o for o in bpy.data.objects if o.type == "EMPTY" and o.name.startswith("wheel_")), key=lambda o: o.name)
    head = bpy.data.objects.get("turret") if cfg.get("rig") else None
    head_parts = [o for o in head.children_recursive if o.type == "MESH"] if head else []
    if head:
        head.animation_data_clear()             # its turn in the .blend is for looking at; the renders aim it
    root = bpy.data.objects.new("Root", None)
    sc.collection.objects.link(root)
    pts = [o.matrix_world @ Vector(c) for o in parts for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    # world units: one tile is TILE_W wide; the model is scaled to its length in tiles, sitting on z = 0
    tile = 1.0
    along_y = (hi.y - lo.y) > (hi.x - lo.x)
    scale = cfg["length_tiles"] * tile / max(hi.x - lo.x, hi.y - lo.y)
    # wheels: round in side view (across the long axis), near the ground, not too wide
    H = hi.z - lo.z
    side = 0 if along_y else 1                     # the axle runs across the vehicle
    wheels = []
    if rig_wheels:
        wheels = [o for w in rig_wheels for o in w.children_recursive if o.type == "MESH"]
    elif cfg.get("wheels", True) and not cfg.get("hover"):
        for o in parts:
            p = [o.matrix_world @ Vector(c) for c in o.bound_box]
            olo = Vector([min(v[i] for v in p) for i in range(3)])
            ohi = Vector([max(v[i] for v in p) for i in range(3)])
            dlong, dz, dside = (ohi.y - olo.y, ohi.z - olo.z, ohi.x - olo.x) if along_y else (ohi.x - olo.x, ohi.z - olo.z, ohi.y - olo.y)
            width = (hi.x - lo.x) if along_y else (hi.y - lo.y)
            if olo.z < lo.z + 0.12 * H and 0.18 * H < dz < 0.75 * H and abs(dlong - dz) < 0.22 * max(dlong, dz) and dside < 0.4 * width:
                wheels.append(o)
        if len(wheels) < 2:
            wheels = []
    print(f"WHEELS {vid}: {len(wheels)}")
    # everything the import made hangs off the root (Tripo files nest their parts under an empty)
    for o in list(bpy.data.objects):
        if o.parent is None and o is not root:
            o.parent = root
            o.matrix_parent_inverse = Matrix.Identity(4)
    bpy.context.view_layer.update()
    hover = cfg.get("hover")
    lift = hover["height"] * tile if hover else 0.0
    root.matrix_world = Matrix.Translation((0, 0, lift)) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-centre)
    holder = bpy.data.objects.new("Turn", None)
    sc.collection.objects.link(holder)
    root.parent = holder
    bpy.context.view_layer.update()
    length = cfg["length_tiles"] * tile
    height = (hi.z - lo.z) * scale + lift
    glow_light = glow(parts, hover, lift, height - lift, length) if hover else None

    ppu = TILE_PX / (tile * math.sqrt(2))
    bpy.ops.mesh.primitive_plane_add(size=length * 8)
    bpy.context.active_object.is_shadow_catcher = True
    cam = bpy.data.objects.new("Camera_Sprite", bpy.data.cameras.new("Camera_Sprite"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.clip_end = 1000
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    sc.camera = cam
    rot = cam.rotation_euler.to_matrix()
    RIGHT, UP, FWD = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, -1))
    light_dir = (sun.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()

    # one canvas for every direction: a cylinder round the vehicle plus its shadow
    r = length / 2 * 1.05
    ring = [Vector((math.cos(a) * r, math.sin(a) * r, z)) for a in [i * math.pi / 8 for i in range(16)] for z in (0, height)]
    ring += [p + light_dir * (p.z / -light_dir.z) for p in ring if p.z > 0]
    pad = 4

    def frame_canvas(k):
        p = ppu * RES * k
        us, vs = [q.dot(RIGHT) for q in ring], [q.dot(UP) for q in ring]
        u0, v0 = min(us) - pad / p, min(vs) - pad / p
        w = math.ceil((max(us) - min(us)) * p) + 2 * pad
        h = math.ceil((max(vs) - min(vs)) * p) + 2 * pad
        sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
        cam.data.ortho_scale = w / p
        cam.location = RIGHT * (u0 + w / p / 2) + UP * (v0 + h / p / 2) - FWD * 100
        geo.update(u0=u0, v1=v0 + h / p, p=p, w=w, h=h)
        return w, h, {"x": round((0 - u0) * p, 1), "y": round((v0 + h / p - 0) * p, 1)}

    geo = {}

    def border(points):
        """Render only the screen box around these world points: the wheel layers are small."""
        us = [(q.dot(RIGHT) - geo["u0"]) * geo["p"] for q in points]
        vs = [(geo["v1"] - q.dot(UP)) * geo["p"] for q in points]
        m = 4
        sc.render.use_border, sc.render.use_crop_to_border = True, False
        sc.render.border_min_x = max(0.0, (min(us) - m) / geo["w"])
        sc.render.border_max_x = min(1.0, (max(us) + m) / geo["w"])
        sc.render.border_min_y = max(0.0, 1 - (max(vs) + m) / geo["h"])
        sc.render.border_max_y = min(1.0, 1 - (min(vs) - m) / geo["h"])

    out = os.path.join("tools", "blender", "frames", "vehicles", vid)
    width = ((hi.y - lo.y) if not along_y else (hi.x - lo.x)) * scale
    os.makedirs(out, exist_ok=True)
    nose = math.radians(cfg.get("nose_deg", -90 if along_y else 0))

    def face(d):
        holder.rotation_euler = (0, 0, d * 2 * math.pi / DIRS - nose)
        bpy.context.view_layer.update()

    w, h, anchor = frame_canvas(1)
    p = geo["p"]
    catcher = [o for o in sc.objects if o.type == "MESH" and o.is_shadow_catcher][0]
    if STILL:
        # just one direction, STILL[1] x the game's canvas and without its shadow: a still to make a video from
        d, k = STILL
        frame_canvas(k)
        face(d)
        catcher.hide_render = True
        # HIDE=<handle>,...: leave out the parts under these rig handles (`ore`: the harvester empty)
        hide = [h for h in os.environ.get("HIDE", "").split(",") if h]
        for h in hide:
            for o in bpy.data.objects[h].children_recursive:
                o.hide_render = True
        sc.cycles.samples = 128
        sc.render.filepath = os.path.join(out, f"still_{d}_x{k}{''.join('_no_' + h for h in hide)}.png")
        bpy.ops.render.render(write_still=True)
        print("STILL", sc.render.filepath)
        return

    def screen(q):
        """Frame pixels of a world offset from the vehicle's ground centre, relative to the anchor."""
        return {"x": round(q.dot(RIGHT) * p, 1), "y": round(-q.dot(UP) * p, 1)}

    def spin_rig(f):
        """Rigged wheels: their own animation, f / WHEEL_FRAMES of the way through its turn."""
        t = sc.frame_start + f * (sc.frame_end - sc.frame_start + 1) / WHEEL_FRAMES
        sc.frame_set(int(t), subframe=t - int(t))

    turret = None
    if head:
        # where the head turns (its empty) and its gun's tip, with the vehicle facing world direction 0
        holder.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        pivot = head.matrix_world.translation.copy()
        pivot_ground = Vector((pivot.x, pivot.y, 0))
        ahead = Vector((math.cos(nose), math.sin(nose), 0))
        head_pts = [o.matrix_world @ v.co for o in head_parts for v in o.data.vertices]
        reach = max((q - pivot).dot(ahead) for q in head_pts)
        tip_pts = [q for q in head_pts if (q - pivot).dot(ahead) > reach - 0.01 * length]
        tip = sum(tip_pts, Vector()) / len(tip_pts)
        turret = {"directions": TURRET_DIRECTIONS, "pivot": [], "muzzle": []}
    # its guns' tips, in the model's frame with the nose along world +X (forward, left, up)
    muzzles = [Vector((m[0] * length, m[1] * width, lift + m[2] * (height - lift))) for m in cfg.get("muzzle", [])]
    muzzle_px = []
    for d in range(DIRS):
        face(d)
        if hover:
            # the unit alone (the game bobs it), then its shadow alone, without the light under it
            catcher.hide_render = True
            sc.render.filepath = os.path.join(out, f"dir_{d}.png")
            bpy.ops.render.render(write_still=True)
            catcher.hide_render = False
            glow_light.hide_render = True
            for o in parts:
                o.visible_camera = False
            # its shadow from a sun almost overhead: right under it, so you can tell where it is (the low sun the
            # rest share would throw a floating unit's shadow far off to one side)
            sun_rot = sun.rotation_euler.copy()
            sun.rotation_euler = (math.radians(HOVER_SUN_DEG), 0, sun_rot.z)
            sc.render.filepath = os.path.join(out, f"shadow_{d}.png")
            bpy.ops.render.render(write_still=True)
            sun.rotation_euler = sun_rot
            for o in parts:
                o.visible_camera = True
            glow_light.hide_render = False
        else:
            sc.render.filepath = os.path.join(out, f"dir_{d}.png")
            bpy.ops.render.render(write_still=True)
        turn = Matrix.Rotation(d * 2 * math.pi / DIRS, 3, "Z")
        muzzle_px.append([screen(turn @ m) for m in muzzles])
        if head:
            # the hull without its head (the game draws the head over it, aimed on its own)
            for o in head_parts:
                o.hide_render = True
            sc.render.filepath = os.path.join(out, f"hull_{d}.png")
            bpy.ops.render.render(write_still=True)
            for o in head_parts:
                o.hide_render = False
            turret["pivot"].append(screen(holder.matrix_world.to_3x3() @ pivot_ground))
        if not wheels:
            continue
        # the wheels alone, turning: the rest of the vehicle hides them where it's in front
        rest = {o: o.matrix_world.copy() for o in wheels}
        for o in parts:
            o.is_holdout = o not in wheels
        catcher.hide_render = True
        samples = sc.cycles.samples
        sc.cycles.samples = 24
        border([o.matrix_world @ Vector(c) for o in wheels for c in o.bound_box])
        axle = holder.matrix_world.to_3x3() @ (Vector((1, 0, 0)) if side == 0 else Vector((0, 1, 0)))
        for f in range(WHEEL_FRAMES):
            if rig_wheels:
                spin_rig(f)
            else:
                a = -2 * math.pi * f / WHEEL_FRAMES
                for o in wheels:
                    c = sum((rest[o] @ Vector(k) for k in o.bound_box), Vector()) / 8
                    o.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(a, 4, axle) @ Matrix.Translation(-c) @ rest[o]
            bpy.context.view_layer.update()
            sc.render.filepath = os.path.join(out, f"wheel_{d}_{f}.png")
            bpy.ops.render.render(write_still=True)
        if rig_wheels:
            spin_rig(0)
        else:
            for o in wheels:
                o.matrix_world = rest[o]
        for o in parts:
            o.is_holdout = False
        catcher.hide_render = False
        sc.render.use_border = False
        sc.cycles.samples = samples
        bpy.context.view_layer.update()
    if head:
        # the head alone in each direction, its pivot over the ground centre (the anchor); no shadow, as it's drawn
        # over the hull
        for o in parts:
            o.hide_render = o not in head_parts
        catcher.hide_render = True
        for t in range(TURRET_DIRECTIONS):
            holder.rotation_euler = (0, 0, t * 2 * math.pi / TURRET_DIRECTIONS - nose)
            bpy.context.view_layer.update()
            turn = holder.matrix_world.to_3x3()
            holder.location = -(turn @ pivot_ground)
            bpy.context.view_layer.update()
            turret["muzzle"].append(screen(turn @ (tip - pivot_ground)))
            sc.render.filepath = os.path.join(out, f"turret_{t}.png")
            bpy.ops.render.render(write_still=True)
        holder.location = (0, 0, 0)
        for o in parts:
            o.hide_render = False
        catcher.hide_render = False
    # its clips: the whole vehicle (and its shadow) on the same canvas, `frames` steps through each marked range
    clips = {}
    for name, c in cfg.get("clips", {}).items():
        marks = {m.name: m.frame for m in sc.timeline_markers}
        start, end = marks[name], marks[f"{name}_end"]
        n, loop = c["frames"], c.get("loop", False)
        clips[name] = {"frames": n, "fps": round(n * sc.render.fps / sc.render.fps_base / (end - start + 1), 3), "loop": loop}
        step = (end - start + 1) / n if loop else (end - start) / (n - 1)
        catcher.hide_render = bool(hover)      # a hovering unit's clips are it alone, as its directions
        for d in range(DIRS):
            face(d)
            for f in range(n):
                t = start + f * step
                sc.frame_set(int(t), subframe=t - int(t))
                sc.render.filepath = os.path.join(out, f"clip_{name}_{d}_{f}.png")
                bpy.ops.render.render(write_still=True)
        sc.frame_set(sc.frame_start)
        catcher.hide_render = False
    # the card view: bigger and cleaner (a hovering unit's shadow from the sun overhead, as in its frames)
    if hover:
        sun.rotation_euler = (math.radians(HOVER_SUN_DEG), 0, sun.rotation_euler.z)
    frame_canvas(CARD_SCALE)
    sc.cycles.samples = 128
    face(CARD_DIR)
    sc.render.filepath = os.path.join(out, "card.png")
    bpy.ops.render.render(write_still=True)
    json.dump({"w": w, "h": h, "anchor": anchor, "res": RES, "directions": DIRS, "length_tiles": cfg["length_tiles"],
               **({"wheel_frames": WHEEL_FRAMES} if wheels else {}), **({"turret": turret} if turret else {}),
               **({"clips": clips} if clips else {}),
               **({"hover": {"height_px": round(lift * p, 1), "glow": hover["glow"]}} if hover else {}),
               **({"muzzle": muzzle_px} if muzzles else {})},
              open(os.path.join(out, "frames.json"), "w"), indent=1)
    print("DONE vehicle", vid, f"{w}x{h}")


for vid, cfg in CONFIG.items():
    if WANT and vid != WANT:
        continue
    render_vehicle(vid, cfg)
