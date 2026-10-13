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
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

CONFIG = json.load(open(os.path.join("tools", "blender", "vehicles.json")))
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
WANT = args[0] if args else None

TILE_PX = 128
RES = 1.5
DIRS = 16
CARD_DIR = 13                                   # nose to the bottom left (towards the camera, a little left)
WHEEL_FRAMES = 6
TURRET_DIRECTIONS = 32                          # as the defences' heads (the sim aims in as many)
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


def render_vehicle(vid, cfg):
    if cfg.get("rig"):
        bpy.ops.wm.open_mainfile(filepath=os.path.join("art", "models", "tripo", cfg["rig"]), load_ui=False)
        for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
            bpy.data.objects.remove(o)
        sc, sun = setup_scene()
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc, sun = setup_scene()
        bpy.ops.import_scene.gltf(filepath=os.path.join("art", "models", "tripo", f"{vid}.glb"))
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
    elif cfg.get("wheels", True):
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
    root.matrix_world = Matrix.Scale(scale, 4) @ Matrix.Translation(-centre)
    holder = bpy.data.objects.new("Turn", None)
    sc.collection.objects.link(holder)
    root.parent = holder
    bpy.context.view_layer.update()
    length = cfg["length_tiles"] * tile
    height = (hi.z - lo.z) * scale

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
    os.makedirs(out, exist_ok=True)
    nose = math.radians(cfg.get("nose_deg", -90 if along_y else 0))

    def face(d):
        holder.rotation_euler = (0, 0, d * 2 * math.pi / DIRS - nose)
        bpy.context.view_layer.update()

    w, h, anchor = frame_canvas(1)
    p = geo["p"]
    catcher = [o for o in sc.objects if o.type == "MESH" and o.is_shadow_catcher][0]

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
    for d in range(DIRS):
        face(d)
        sc.render.filepath = os.path.join(out, f"dir_{d}.png")
        bpy.ops.render.render(write_still=True)
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
    # the card view: bigger and cleaner
    frame_canvas(CARD_SCALE)
    sc.cycles.samples = 128
    face(CARD_DIR)
    sc.render.filepath = os.path.join(out, "card.png")
    bpy.ops.render.render(write_still=True)
    json.dump({"w": w, "h": h, "anchor": anchor, "res": RES, "directions": DIRS, "length_tiles": cfg["length_tiles"],
               **({"wheel_frames": WHEEL_FRAMES} if wheels else {}), **({"turret": turret} if turret else {})},
              open(os.path.join(out, "frames.json"), "w"), indent=1)
    print("DONE vehicle", vid, f"{w}x{h}")


for vid, cfg in CONFIG.items():
    if WANT and vid != WANT:
        continue
    render_vehicle(vid, cfg)
