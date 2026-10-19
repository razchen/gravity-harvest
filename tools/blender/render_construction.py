"""Render a building's construction stages from a model made of separate parts (a Tripo "parts" GLB).

Run from the repo root:
    Blender -b --factory-startup -P tools/blender/render_construction.py -- tools/blender/construction/refinery.json
then pack the frames into the game atlas:
    python3 tools/sprites/pack_construction.py tools/blender/construction/refinery.json

An `anims` list (and `door`, see the animations section below) also renders `anim_base.png` (the finished building
without its moving parts) and `anim_<name>_<f>.png` (only that animation's parts, the rest holding them out); its
`effects` become pixel points for the game's steam, flames, glows, lights and sparks.

With `rig` (a .blend of the model in art/models/, the Tripo import plus empties) the model is loaded from it instead, and
an anim with `rig` (the names of its empties) is that .blend's own keyframed animation: `frames` samples of the scene's
frame range (a loop), moving every part under those empties; the stages show it at its first frame. An effect's `frame`
puts its point where that part is at that frame of the .blend's timeline (sparks on an arm while it works).

`hide` lists parts to leave out altogether. `turn` (0, 90, 180 or 270) spins the model first, so its entrance faces left like every building's (see
docs/ADDING_CONTENT.md). The config lists which parts (`tripo_part_<n>`) arrive in each stage; a stage without a `parts` list is filled
automatically (see `auto_stages`), and the grouping used is written to frames.json, to copy into the config and adjust. Every stage is rendered from the same camera,
framing and resolution, so the stages line up exactly and the last one is the finished building. For each stage the
script writes, to tools/blender/frames/construction/<atlas>/:
- `stage_<n>.png`: everything built so far, plus a flat deck plate where the next stage's parts will stand (it
  covers the holes where they attach);
- `new_<n>.png`: only what arrives at stage n (its parts and the next stage's deck plates), with everything already
  built held out, so it can be faded in over stage n-1.
Camera, sun and shadow catcher match render_building.py.

A turret (a `turret` section in the config: `cut`, the height share where its head starts, and `directions`) also
gets `turn_<d>.png`: the finished building with its head turned to face direction d (d * 360/directions degrees
counter-clockwise from +X seen from above, like the units). The head is the largest group of touching parts starting
above `cut` (stray pieces on the base stay put) and turns about the middle of its lowest parts; the framing covers
every direction, and the stages show the head at its rest direction (the one nearest how the model faces), so the
last stage is turn_<rest>.

With PREVIEW=<n> it renders only the finished building, n times bigger and with more samples, to `preview.png`:
the dev pages' picture of it (tools/sprites/pack_previews.py makes the final image).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

CONFIG = sys.argv[sys.argv.index("--") + 1]
C = json.load(open(CONFIG))
OUT = os.path.join("tools", "blender", "frames", "construction", C["atlas"])
os.makedirs(OUT, exist_ok=True)

if C.get("rig"):
    # the model with its rig (empties carrying the moving parts) and their keyframes, at rest on its first frame
    bpy.ops.wm.open_mainfile(filepath=C["rig"], load_ui=False)
    for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o)
    scene = bpy.context.scene
    scene.frame_set(scene.frame_start)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=C["model"])
col = scene.collection
parts = [o for o in bpy.data.objects if o.type == "MESH"]
# `hide`: parts left out altogether (what the game shows another way, like the Motor Works' rover in its bay)
if C.get("hide"):
    for o in [o for o in parts if int(o.name.split("_")[-1].split(".")[0]) in C["hide"]]:
        bpy.data.objects.remove(o)
    parts = [o for o in bpy.data.objects if o.type == "MESH"]
# `turn` (90 deg steps, counter-clockwise seen from above): put the entrance on the left (docs/ADDING_CONTENT.md)
if C.get("turn"):
    _pts = [o.matrix_world @ Vector(c) for o in parts for c in o.bound_box]
    _c = Vector(((min(p.x for p in _pts) + max(p.x for p in _pts)) / 2, (min(p.y for p in _pts) + max(p.y for p in _pts)) / 2, 0))
    _spin = Matrix.Translation(_c) @ Matrix.Rotation(math.radians(C["turn"]), 4, "Z") @ Matrix.Translation(-_c)
    for o in bpy.data.objects:
        if o.parent is None:
            o.matrix_world = _spin @ o.matrix_world
    bpy.context.view_layer.update()
STAGES = len(C["stages"])


def part_no(o):
    return int(o.name.split("_")[-1].split(".")[0])


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi, pts


lo, hi, pts = bounds(parts)
H = hi.z - lo.z


def auto_stages():
    """Group the parts into stages the way a building goes up: flat pieces first (the foundation), then the rest in
    order of how high they sit (their middle), split so each stage adds about the same bulk; small pieces sitting
    high up arrive last, as details."""
    info = []
    for o in parts:
        plo, phi, _ = bounds([o])
        size = phi - plo
        info.append({"n": part_no(o), "zmin": (plo.z - lo.z) / H, "zmax": (phi.z - lo.z) / H, "zmid": ((plo.z + phi.z) / 2 - lo.z) / H,
                     "bulk": max(size.x, 1e-6) * max(size.y, 1e-6) * max(size.z, 0.02 * H)})
    total = sum(i["bulk"] for i in info)
    out = {}
    rest = []
    for i in info:
        if i["zmax"] <= 0.08:
            out[i["n"]] = 1
        elif i["bulk"] < 0.004 * total and i["zmid"] > 0.35:
            out[i["n"]] = STAGES
        else:
            rest.append(i)
    rest.sort(key=lambda i: i["zmid"])
    middle = STAGES - 2                          # stages between the foundation and the details
    bulk = sum(i["bulk"] for i in rest) or 1
    acc = 0.0
    for i in rest:
        out[i["n"]] = 2 + min(middle - 1, int(acc / bulk * middle))
        acc += i["bulk"]
    return out


stage_of = {n: s for s, st in enumerate(C["stages"], 1) for n in st.get("parts", [])}
if any("parts" not in st for st in C["stages"]):
    auto = auto_stages()
    stage_of = {**auto, **stage_of}             # listed parts keep their stage
    print("AUTO stages:", {s: sum(1 for v in stage_of.values() if v == s) for s in range(1, STAGES + 1)})


def part_stage(o):
    n = part_no(o)
    if n not in stage_of:
        print(f"WARNING {o.name} is in no stage: it arrives with the last one")
    return stage_of.get(n, STAGES)


# --- turret head --------------------------------------------------------------------------------------------------
TURRET = C.get("turret")
head, pivot, rest, swept = [], None, 0, []
if TURRET:
    def zmin_share(o):
        return (bounds([o])[0].z - lo.z) / H
    cand = [o for o in parts if zmin_share(o) >= TURRET["cut"]]
    gap = 0.02 * H
    boxes = {o.name: bounds([o])[:2] for o in cand}

    def touch(a, b):
        (alo, ahi), (blo, bhi) = boxes[a.name], boxes[b.name]
        return all(alo[i] - gap <= bhi[i] and blo[i] - gap <= ahi[i] for i in range(3))
    # the largest group of touching parts
    left, groups = list(cand), []
    while left:
        grp, todo = [], [left.pop()]
        while todo:
            o = todo.pop()
            grp.append(o)
            near = [q for q in left if touch(o, q)]
            for q in near:
                left.remove(q)
            todo += near
        groups.append(grp)
    head = max(groups, key=lambda g: sum((bounds([o])[1] - bounds([o])[0]).length for o in g)) if groups else []
    ring_part = TURRET.get("ring_part")
    if ring_part is not None:
        # a turret on a turntable ring: the head is what touches the ring, starts no lower, within `radius` of its axis
        ring = next(o for o in parts if part_no(o) == ring_part)
        rvs = [ring.matrix_world @ v.co for v in ring.data.vertices]
        rz = min(v.z for v in rvs)
        axis = Vector(((min(v.x for v in rvs) + max(v.x for v in rvs)) / 2, (min(v.y for v in rvs) + max(v.y for v in rvs)) / 2, rz))
        near = lambda o: ((lambda b: ((b[0].x + b[1].x) / 2 - axis.x) ** 2 + ((b[0].y + b[1].y) / 2 - axis.y) ** 2)(bounds([o])) <= TURRET["radius"] ** 2)
        cand = [o for o in parts if bounds([o])[0].z >= rz - 0.005 and near(o)]
        boxes.update({o.name: bounds([o])[:2] for o in cand})
        head, todo = [ring], [ring]
        while todo:
            o = todo.pop()
            for q in cand:
                if q not in head and touch(o, q):
                    head.append(q)
                    todo.append(q)
        # parts that belong to the head but reach out past `radius` (a barrel's tip)
        head += [o for o in parts if part_no(o) in TURRET.get("include", []) and o not in head]
    hz = min(bounds([o])[0].z for o in head)
    bottom = [o for o in head if bounds([o])[0].z <= hz + 0.12 * H] or head
    blo, bhi, _ = bounds(bottom)
    pivot = Vector(((blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2, hz))
    if ring_part is not None:
        pivot = axis
    elif TURRET.get("pivot") == "rim":
        # the centre of the head's lowest ring of vertices (its round base), not its lowest parts' box
        vs = [o.matrix_world @ v.co for o in head for v in o.data.vertices]
        z0 = min(v.z for v in vs)
        ring = [v for v in vs if v.z <= z0 + 0.04 * H]
        pivot = Vector(((min(v.x for v in ring) + max(v.x for v in ring)) / 2, (min(v.y for v in ring) + max(v.y for v in ring)) / 2, z0))
    # which way the model faces: towards the head point farthest from the pivot (the muzzle)
    tip = max((p for _, _, ps in [bounds([o]) for o in head] for p in ps), key=lambda p: (p.x - pivot.x) ** 2 + (p.y - pivot.y) ** 2)
    facing = math.atan2(tip.y - pivot.y, tip.x - pivot.x)
    N = TURRET["directions"]
    STEP = 2 * math.pi / N
    rest = round(facing / STEP) % N
    pivot_obj = bpy.data.objects.new("TurretPivot", None)
    col.objects.link(pivot_obj)
    pivot_obj.location = pivot
    bpy.context.view_layer.update()
    for o in head:
        mw = o.matrix_world.copy()
        o.parent = pivot_obj
        o.matrix_world = mw
    head_pts = [p for o in head for p in bounds([o])[2]]
    for d in range(N):
        a = d * STEP - facing
        ca, sa = math.cos(a), math.sin(a)
        swept += [Vector((pivot.x + (p.x - pivot.x) * ca - (p.y - pivot.y) * sa, pivot.y + (p.x - pivot.x) * sa + (p.y - pivot.y) * ca, p.z)) for p in head_pts]
    print(f"TURRET head {len(head)} parts (of {len(cand)} above the cut), pivot {tuple(round(v, 3) for v in pivot)}, faces {math.degrees(facing):.0f} deg, rest {rest}")
    print("TURRET head parts:", sorted(part_no(o) for o in head))
    if os.environ.get("DRY"):              # DRY=1: just report the head
        sys.exit(0)


def face(d):
    """Turn the head to direction d."""
    if TURRET:
        pivot_obj.rotation_euler = (0, 0, d * STEP - facing)
        bpy.context.view_layer.update()


face(rest)


def rig_frame(anim, f):
    """The .blend timeline frame for frame f (of anim's `frames`) of a keyframed anim: one loop of the scene's range."""
    span = scene.frame_end - scene.frame_start + 1
    return scene.frame_start + f * span / anim["frames"]


def set_frame(t):
    scene.frame_set(int(t), subframe=t - int(t))


def rig_parts(anim):
    return {o for name in anim["rig"] for o in bpy.data.objects[name].children_recursive if o.type == "MESH"}


# keyframed anims: the framing covers everywhere their parts go
for a in C.get("anims", []):
    if a.get("rig"):
        for f in range(a["frames"]):
            set_frame(rig_frame(a, f))
            swept += bounds(list(rig_parts(a)))[2]
        set_frame(scene.frame_start)
TILE = max(hi.x - lo.x, hi.y - lo.y) / (C["footprint"] * 0.95)    # model fills ~95% of its footprint
PPU = 128 / (TILE * math.sqrt(2))
ANCHOR = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))

# --- light and render settings (as render_building.py) ----------------------------------------------------------
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
col.objects.link(sun)
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
scene.world = bpy.data.worlds.new("World")
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

bpy.ops.mesh.primitive_plane_add(size=(hi - lo).length * 6, location=(ANCHOR.x, ANCHOR.y, lo.z + 0.0005 * H))
catcher = bpy.context.active_object
catcher.is_shadow_catcher = True

cam = bpy.data.objects.new("Camera_Sprite", bpy.data.cameras.new("Camera_Sprite"))
col.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.sensor_fit = "HORIZONTAL"
cam.data.clip_end = 1000
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
rot = cam.rotation_euler.to_matrix()
RIGHT, UP, FWD = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, -1))
light_dir = (sun.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()

# framing: the whole building plus its shadow tips, the same for every stage
if swept:
    slo = Vector([min(p[i] for p in pts + swept) for i in range(3)])
    shi = Vector([max(p[i] for p in pts + swept) for i in range(3)])
    pts = pts + swept
else:
    slo, shi = lo, hi
top = [Vector((x, y, shi.z)) for x in (slo.x, shi.x) for y in (slo.y, shi.y)]
tips = [p + light_dir * ((p.z - lo.z) / -light_dir.z) for p in top]
frame = pts + tips
pad = 10
us, vs = [p.dot(RIGHT) for p in frame], [p.dot(UP) for p in frame]
u0, v0 = min(us) - pad / PPU, min(vs) - pad / PPU
w = math.ceil((max(us) - min(us)) * PPU) + 2 * pad
h = math.ceil((max(vs) - min(vs)) * PPU) + 2 * pad
u1, v1 = u0 + w / PPU, v0 + h / PPU
scene.render.resolution_x, scene.render.resolution_y = w, h
cam.data.ortho_scale = w / PPU
cam.location = RIGHT * (u0 + u1) / 2 + UP * (v0 + v1) / 2 - FWD * (H * 50 + 100)
anchor = {"x": round((ANCHOR.dot(RIGHT) - u0) * PPU, 1), "y": round((v1 - ANCHOR.dot(UP)) * PPU, 1)}

# --- deck plates: a thin dark steel slab under each part, shown while that part is the next to arrive --------------
steel = bpy.data.materials.new("DeckSteel")
steel.use_nodes = True
bsdf = steel.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.09, 0.09, 0.1, 1)
bsdf.inputs["Metallic"].default_value = 0.6
bsdf.inputs["Roughness"].default_value = 0.5


DECK_MIN_AREA = C.get("deck_min_area", 0)      # skip decks under parts smaller than this share of the building's area


def deck_for(part):
    plo, phi, _ = bounds([part])
    if (phi.x - plo.x) * (phi.y - plo.y) < DECK_MIN_AREA * (hi.x - lo.x) * (hi.y - lo.y):
        return None
    t = max(0.0035 * H, 0.004 * (phi - plo).length)
    bpy.ops.mesh.primitive_cube_add(size=1, location=((plo.x + phi.x) / 2, (plo.y + phi.y) / 2, plo.z + 0.6 * t))
    deck = bpy.context.active_object
    deck.name = f"deck_{part.name}"
    deck.scale = (phi.x - plo.x, phi.y - plo.y, 1.2 * t)
    deck.data.materials.append(steel)
    return deck


# --- a made door: a roll-up shutter filling the entrance (models whose doorway has no door part of its own) -------
DOOR_PART = 9000


def make_door(cfg):
    """Find the doorway on the entrance face (-Y): rays from the front, over the lower part of the building; the
    doorway is the region reaching the ground that goes much deeper than the wall around it. Fill it with a
    shutter of slats (dark metal, a hazard strip along the bottom) just inside its frame."""
    if cfg.get("rect"):
        # measured by hand: x and z extents, and how deep (y) it stands
        r = cfg["rect"]
        return build_door(r["x"][0], r["x"][1], r["z"][0], r["z"][1], r["y"], cfg)
    dg = bpy.context.evaluated_depsgraph_get()
    NX, NZ = 140, 70
    zmax = lo.z + cfg.get("max_height", 0.55) * H
    grid = []
    for iz in range(NZ):
        row = []
        for ix in range(NX):
            x = lo.x + (ix + 0.5) / NX * (hi.x - lo.x)
            z = lo.z + (iz + 0.5) / NZ * (zmax - lo.z)
            hit, loc, *_ = scene.ray_cast(dg, Vector((x, lo.y - 0.05, z)), Vector((0, 1, 0)))
            row.append(loc.y if hit else None)     # None: the ray missed (open air beside the building)
        grid.append(row)
    flat = sorted(v for r in grid for v in r if v is not None)
    facade = flat[len(flat) // 5]
    deep = [[v is not None and v > facade + cfg.get("depth", 0.045) for v in r] for r in grid]
    # connected regions of deep cells; keep the biggest one that reaches the ground
    seen, best = set(), None
    for iz0 in range(NZ):
        for ix0 in range(NX):
            if not deep[iz0][ix0] or (iz0, ix0) in seen:
                continue
            todo, cells = [(iz0, ix0)], []
            seen.add((iz0, ix0))
            while todo:
                iz, ix = todo.pop()
                cells.append((iz, ix))
                for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = (iz + dz, ix + dx)
                    if 0 <= n[0] < NZ and 0 <= n[1] < NX and deep[n[0]][n[1]] and n not in seen:
                        seen.add(n)
                        todo.append(n)
            # a doorway reaches the ground and is framed by wall on both sides (not open air at the scan's edges)
            edge = any(c[1] in (0, NX - 1) for c in cells)
            if not edge and min(c[0] for c in cells) <= 4 and (best is None or len(cells) > len(best)):
                best = cells
    if not best:
        print("DOOR: no doorway found")
        return []
    xs = sorted(c[1] for c in best)
    zs = sorted(c[0] for c in best)
    # the doorway's box (trim stray cells), and where its frame stands
    ix0, ix1 = xs[len(xs) // 20], xs[-1 - len(xs) // 20]
    iz0, iz1 = 0, zs[-1 - len(zs) // 20]
    cx = lambda i: lo.x + (i + 0.5) / NX * (hi.x - lo.x)
    cz = lambda i: lo.z + (i + 0.5) / NZ * (zmax - lo.z)
    x0, x1, z0, z1 = cx(ix0) - 0.002, cx(ix1) + 0.002, lo.z, cz(iz1) + 0.004
    frame = [v for iz in range(iz0, min(NZ, iz1 + 2)) for ix in (max(0, ix0 - 2), min(NX - 1, ix1 + 2)) if (v := grid[iz][ix]) is not None]
    y = sorted(frame)[len(frame) // 2] + cfg.get("inset", 0.006)
    return build_door(x0, x1, z0, z1, y, cfg)


def build_door(x0, x1, z0, z1, y, cfg):
    """A roll-up shutter filling x0..x1, z0..z1 at depth y: slats of dark metal, a hazard strip at the bottom."""
    print(f"DOOR doorway x {x0:.3f}..{x1:.3f}, z {z0:.3f}..{z1:.3f}, at y {y:.3f}")
    metal = bpy.data.materials.new("DoorMetal")
    metal.use_nodes = True
    b = metal.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.11, 0.115, 0.125, 1)
    b.inputs["Metallic"].default_value = 0.75
    b.inputs["Roughness"].default_value = 0.45
    stripe = bpy.data.materials.new("DoorStripe")
    stripe.use_nodes = True
    sb = stripe.node_tree.nodes["Principled BSDF"]
    sb.inputs["Base Color"].default_value = (0.8, 0.55, 0.05, 1)
    sb.inputs["Roughness"].default_value = 0.5
    made = []
    slats = cfg.get("slats", 7)
    tall = z1 - z0
    for i in range(slats):
        sz0 = z0 + i * tall / slats
        bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, y, sz0 + tall / slats / 2))
        o = bpy.context.active_object
        o.scale = (x1 - x0, 0.008 if i % 2 else 0.011, tall / slats * 0.92)
        o.data.materials.append(stripe if i == 0 else metal)
        o.name = f"tripo_part_{DOOR_PART + i}"
        made.append(o)
    return made


DOOR_MADE = []
if "make" in C.get("door", {}):
    DOOR_MADE = make_door(C["door"]["make"])
    parts += DOOR_MADE
    C["door"]["parts"] = [part_no(o) for o in DOOR_MADE]
    if os.environ.get("DRY") and DOOR_MADE:     # DRY=1: a quick look at where the door went, then stop
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.color_type = "OBJECT"
        for o in parts:
            o.color = (1, 0.1, 0.1, 1) if o in DOOR_MADE else (0.6, 0.6, 0.6, 1)
        scene.render.filepath = os.path.join(OUT, "door_check.png")
        bpy.ops.render.render(write_still=True)
        sys.exit(0)
    if "slide" not in C["door"] and "swing" not in C["door"] and DOOR_MADE:
        top = max((o.matrix_world @ Vector(c)).z for o in DOOR_MADE for c in o.bound_box)
        bot = min((o.matrix_world @ Vector(c)).z for o in DOOR_MADE for c in o.bound_box)
        C["door"]["slide"] = {"axis": "z", "distance": (top - bot) * 1.02}

items = [(o, part_stage(o), deck_for(o)) for o in parts]
NO_DECK = type("NoDeck", (), {"hide_render": True, "is_holdout": False})
items = [(o, st, d if d is not None else NO_DECK()) for o, st, d in items]


def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if os.environ.get("PREVIEW"):
    for o, st, deck in items:
        o.hide_render, o.is_holdout = False, False
        deck.hide_render = True
    scene.render.resolution_percentage = int(float(os.environ["PREVIEW"]) * 100)
    scene.cycles.samples = 128
    render(os.path.join(OUT, "preview.png"))
    print("DONE preview", OUT)
    sys.exit(0)


# ONLY=anims (or turret, or both, comma-separated): render just those, reusing the stage frames already on disk
ONLY = set(filter(None, os.environ.get("ONLY", "").split(",")))
want = lambda part: not ONLY or part in ONLY


def border(points):
    """Render only the screen box around these world points (and a margin): small layers render much faster."""
    if not points:
        return
    us = [(p.dot(RIGHT) - u0) * PPU for p in points]
    vs = [(v1 - p.dot(UP)) * PPU for p in points]
    m = 6
    scene.render.use_border, scene.render.use_crop_to_border = True, False
    scene.render.border_min_x = max(0.0, (min(us) - m) / w)
    scene.render.border_max_x = min(1.0, (max(us) + m) / w)
    scene.render.border_min_y = max(0.0, 1 - (max(vs) + m) / h)
    scene.render.border_max_y = min(1.0, 1 - (min(vs) - m) / h)


for s in (range(1, STAGES + 1) if want("stages") else []):
    # everything built so far, and decks where the next stage goes
    for o, st, deck in items:
        o.hide_render, o.is_holdout = st > s, False
        deck.hide_render, deck.is_holdout = st != s + 1, False
    render(os.path.join(OUT, f"stage_{s}.png"))
    # only what arrives now; what's already built hides it where it's in front, but isn't drawn
    for o, st, deck in items:
        o.hide_render, o.is_holdout = st > s, st < s
    render(os.path.join(OUT, f"new_{s}.png"))
    print(f"RENDERED stage {s}/{STAGES}")

if TURRET and want("turret"):
    for o, st, deck in items:
        o.hide_render, o.is_holdout = False, False
        deck.hide_render = True
    for d in range(N):
        face(d)
        render(os.path.join(OUT, f"turn_{d}.png"))
    face(rest)
    print(f"RENDERED {N} turret directions")

# --- animations: parts that move while the building runs, works, or lets a unit out -------------------------------
# `anims`: [{name, when (always | working | door), frames, fps, groups: [{parts, axis, pivot {part, at}, and one of
# turns (spin, whole turns per loop) | swing (degrees either side) | slide (distance, a door opening) | open (degrees,
# a door swinging open)}]}]; `door` is shorthand for a `when: door` anim, unless it has `video: true` (the game opens it
# with a door video, tools/sprites/key_video.py: the door is only made for the stills). `effects`: [{kind, part, at, color}] become
# pixel points the game draws steam, flames, glows, lights and sparks at.
ANIMS = list(C.get("anims", []))
if C.get("door") and not C["door"].get("video"):
    d = C["door"]
    motion = {"slide": d["slide"]["distance"], "axis": d["slide"]["axis"]} if "slide" in d else {"open": d["swing"]["degrees"], "axis": d["swing"]["axis"], "pivot": d["swing"]["pivot"]}
    ANIMS.append({"name": "door", "when": "door", "frames": d.get("frames", 8), "fps": d.get("fps", 16), "groups": [{"parts": d["parts"], **motion}]})
EFFECTS = C.get("effects", [])
by_no = {part_no(o): o for o in parts}


def rim_centre(objs, share=0.08):
    """The centre of the lowest ring of these parts' vertices (their round base): a true axis for a round thing even
    when spikes or antennas skew its bounding box."""
    vs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    z0, z1 = min(v.z for v in vs), max(v.z for v in vs)
    ring = [v for v in vs if v.z <= z0 + share * (z1 - z0)]
    return Vector(((min(v.x for v in ring) + max(v.x for v in ring)) / 2, (min(v.y for v in ring) + max(v.y for v in ring)) / 2, z0))


def point(part, at):
    if at == "rim":
        return rim_centre([by_no[part]])
    plo, phi, _ = bounds([by_no[part]])
    c = (plo + phi) / 2
    if at == "top":
        c.z = phi.z
    elif at == "bottom":
        c.z = plo.z
    return c


def pivot_of(pv):
    """A pivot: a part's centre / top / bottom, or an exact `xy` (world) at that part's height."""
    p = point(pv["part"], pv.get("at", "centre"))
    if pv.get("xy"):
        p.x, p.y = pv["xy"]
    return p


def px(p):
    return {"x": round((p.dot(RIGHT) - u0) * PPU, 1), "y": round((v1 - p.dot(UP)) * PPU, 1)}


anim_meta = []
if ANIMS and not want("anims"):
    anim_meta = [{"name": a["name"], "when": a["when"], "frames": a["frames"], "fps": a["fps"]} for a in ANIMS]
if ANIMS and want("anims"):
    anim_parts = lambda a: rig_parts(a) if a.get("rig") else {by_no[n] for g in a["groups"] for n in g["parts"]}
    moving = {o for a in ANIMS for o in anim_parts(a)}
    for o, st, deck in items:
        o.hide_render, o.is_holdout = False, False
        deck.hide_render = True
    # the finished building without its moving parts: the base they move over
    for o in moving:
        o.hide_render = True
    render(os.path.join(OUT, "anim_base.png"))
    for o in moving:
        o.hide_render = False
    # an empty per group, at its pivot, carrying its parts
    rigs = []
    for a in ANIMS:
        for g in a.get("groups", []):
            e = bpy.data.objects.new("Move", None)
            col.objects.link(e)
            pv = g.get("pivot")
            e.location = pivot_of(pv) if pv else (bounds([by_no[n] for n in g["parts"]])[0] + bounds([by_no[n] for n in g["parts"]])[1]) / 2
            bpy.context.view_layer.update()
            for n in g["parts"]:
                o = by_no[n]
                mw = o.matrix_world.copy()
                o.parent = e
                o.matrix_world = mw
            rigs.append((a, g, e, e.location.copy()))
    AXIS = {"x": 0, "y": 1, "z": 2}
    ease = lambda t: t * t * (3 - 2 * t)

    def pose(anim, f):
        """Put `anim`'s groups at frame f (the others at rest); a keyframed anim plays the .blend's timeline."""
        if C.get("rig"):
            set_frame(rig_frame(anim, f) if anim is not None and anim.get("rig") else scene.frame_start)
        for a, g, e, home in rigs:
            k = f if a is anim else 0
            F = a["frames"]
            r, loc = [0.0, 0.0, 0.0], home.copy()
            i = AXIS[g["axis"]]
            if "turns" in g:
                r[i] = 2 * math.pi * g["turns"] * k / F
            elif "swing" in g:
                # `cycles` swings per loop (whole, so it loops) and a `phase` offset: arms in one anim needn't move in step
                r[i] = math.radians(g["swing"]) * math.sin(2 * math.pi * (g.get("cycles", 1) * k / F + g.get("phase", 0)))
            elif "slide" in g:
                loc[i] += g["slide"] * ease(k / max(1, F - 1))
            elif "open" in g:
                r[i] = math.radians(g["open"]) * ease(k / max(1, F - 1))
            e.rotation_euler, e.location = r, loc
        bpy.context.view_layer.update()

    catcher.hide_render = True
    samples = scene.cycles.samples
    scene.cycles.samples = 24                       # the layers are small and move: fewer samples don't show
    for a in ANIMS:
        mine = anim_parts(a)
        # only this anim's parts; everything else hides them where it's in front (and still shades them)
        for o in parts:
            o.is_holdout = o not in mine
        # only the box they sweep through
        swept = []
        for f in range(a["frames"]):
            pose(a, f)
            swept += bounds(list(mine))[2]
        border(swept)
        for f in range(a["frames"]):
            pose(a, f)
            render(os.path.join(OUT, f"anim_{a['name']}_{f}.png"))
        pose(None, 0)
        scene.render.use_border = False
        anim_meta.append({"name": a["name"], "when": a["when"], "frames": a["frames"], "fps": a["fps"]})
        print(f"RENDERED anim {a['name']}: {a['frames']} frames")
    for o in parts:
        o.is_holdout = False
    catcher.hide_render = False
    scene.cycles.samples = samples
def effect_point(fx):
    """An effect's pixel; with `frame`, where its part is at that frame of the .blend's timeline."""
    if fx.get("frame") is not None:
        set_frame(fx["frame"])
    p = px(point(fx["part"], fx.get("at", "centre")))
    if fx.get("frame") is not None:
        set_frame(scene.frame_start)
    return p


effects_meta = [{"kind": fx["kind"], **effect_point(fx), **({"color": fx["color"]} if fx.get("color") else {})} for fx in EFFECTS]

json.dump({"anchor": anchor, "size": {"w": w, "h": h}, "footprint_tiles": C["footprint"], "tile_px": 128,
           "stages": [st["name"] for st in C["stages"]],
           **({"turret": {"directions": N, "rest": rest}} if TURRET else {}),
           **({"anims": anim_meta} if anim_meta else {}), **({"effects": effects_meta} if effects_meta else {}),
           "grouping": {st["name"]: sorted(n for n, v in stage_of.items() if v == s) for s, st in enumerate(C["stages"], 1)}}, open(os.path.join(OUT, "frames.json"), "w"), indent=1)
print("DONE", OUT)
