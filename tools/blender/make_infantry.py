"""Infantry: render a rigged Meshy soldier into the game's sprite sheets.

Run from the repo root, with a unit from UNITS below:
    Blender -b --factory-startup -P tools/blender/make_infantry.py -- rifleman
then pack:
    python3 tools/sprites/pack_infantry.py rifleman
Renders to tools/blender/frames/<unit>/: DIRS directions x (his stance `inf_<d>_idle` + RUN_FRAMES running frames
`inf_<d>_<i>`) and DIRS x his death frames `inf_<d>_die_<i>` of him being shot down, plus frames.json (canvas sizes,
anchors, the rifleman's muzzle pixel per direction) and, for a unit with `card`, card.png (his build card's view). The
packer trims them and writes the game's <unit> and <unit>_death atlases.

The rifleman (rifleman_v2: Meshy's "withSkin" GLBs of one rigged character, one per clip: Running,
Rifle_Aim_Turn_Right and Shot_and_Blown_Back) comes without a gun. The rifle is placed each frame: aiming, its grip is
in the right hand and its barrel runs through the left; running, it follows the right hand pointing the way he runs
(as make_soldier.py did); dying, it keeps its hold on the right hand as he falls. His stance is the steady aim at the
end of Meshy's aim-and-turn clip (frames HOLD), turned so the rifle points along direction d and moved back onto the
spot.

The others come as one GLB with all their clips, and their stance is a separate standing model (`stand`: a static
remesh of the same character in the rig's rest pose), fitted onto the rig's rest pose so standing and running line up.
A `held` prop (the medic's datapad) is gripped in the right hand and follows it in every frame.

The death clips throw them back up to 5.6 m; only `throw` of that is kept (the game's infantry are drawn 3x life
size, so a full throw would be over 3 tiles).

Sprite conventions match make_soldier.py and the buildings: camera 45 deg yaw / 30 deg down, same sun, infantry 3x
life size, rendered at RES x the art scale. Direction d faces world angle d * 360 / DIRS deg, counter-clockwise from +X seen
from above.
"""
import glob
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

M = "art/models/meshy"
UNITS = {
    "rifleman": {
        "src": f"{M}/rifleman_v2", "run": "Running", "aim": "Rifle_Aim", "die": "Shot_and",
        "rifle": f"{M}/assault_rifle.blend",
        "death": (0, 44, 16),                     # frames 0..44 of the death clip in 16 (about 8 a second); he is still after that
        "throw": 0.15,                            # share of the death clip's backwards throw that is kept
    },
    "medic": {
        "src": f"{M}/medic/medic_all_animations.glb", "run": "Running", "die": "Shot_and_Fall_Backward",
        "stand": f"{M}/medic/medic_standing.blend",
        # a scanner with a pistol grip, standing up in its file (screen to -Y, grip at the bottom): 0.3 m long in his hand
        "held": {"blend": f"{M}/medic_datapad.blend", "length": 0.3, "grip": (-0.02, -0.04, -0.62)},
        "death": (8, 78, 20), "throw": 0.5,       # he staggers back for a while before he falls
        "card": True,
    },
    "raider": {
        "src": f"{M}/raider/raider_all_animations.glb", "run": "Running", "die": "Shot_and_Blown_Back",
        "stand": f"{M}/raider/raider_standing.blend",
        "death": (0, 44, 16), "throw": 0.15,      # the rifleman's death clip
        "card": True,
    },
    "infiltrator": {
        "src": f"{M}/infiltrator/infiltrator_all_animations.glb", "run": "Running", "die": "dying_backwards",
        "stand": f"{M}/infiltrator/infiltrator_standing.blend",
        "death": (8, 46, 16), "throw": 0.8,
        "card": True,
    },
}

UNIT = sys.argv[sys.argv.index("--") + 1:][0]
CFG = UNITS[UNIT]
SRC = CFG["src"]
FRAMES_DIR = os.path.join("tools", "blender", "frames", UNIT)
os.makedirs(FRAMES_DIR, exist_ok=True)

METRES_PER_TILE = 4.75 / 3.0                     # infantry 3x life size, as make_soldier.py
RES = 1.5
PPU = RES * 128 / (METRES_PER_TILE * math.sqrt(2))
DIRS, RUN_FRAMES = 16, 12
HOLD = 36                                         # a frame in the aim clip's steady hold (28-44)
DEATH_START, DEATH_END, DEATH_FRAMES = CFG["death"]
RIFLE_LENGTH = 0.85
GRIP = Vector((0.55, 0.0, -0.2))                 # rifle-local grip point (as make_soldier.py)
MUZZLE_TIP = Vector((-0.95, 0.0, 0.05))          # rifle-local muzzle tip
THROW = CFG["throw"]
DEATH_RES = 1.0                                   # the death sheet is bigger (he lies flat): drawn at the art scale
CARD_DIR, CARD_SCALE = 13, 8                      # the card view: towards the camera, a little left, at 8x (as the vehicles')
QUICK = bool(os.environ.get("QUICK"))             # QUICK=1: a few test frames only, no sheets

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection


def clip(key):
    return glob.glob(os.path.join(SRC, f"*{key}*.glb"))[0]


# --- the character (from the run) and the other clips' actions ------------------------------------------------------
bpy.ops.import_scene.gltf(filepath=clip(CFG["run"]) if os.path.isdir(SRC) else SRC)
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig and len(o.data.vertices) > 1000]
for o in list(bpy.data.objects):                  # Meshy's stray icosphere helper
    if o is not rig and o not in body:
        bpy.data.objects.remove(o)
if os.path.isdir(SRC):                            # a GLB per clip
    run = rig.animation_data.action
    actions = {"run": run}
    for key, name in ((CFG["aim"], "aim"), (CFG["die"], "die")):
        before = set(bpy.data.objects)
        had = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=clip(key))
        actions[name] = next(a for a in bpy.data.actions if a not in had)
        for o in set(bpy.data.objects) - before:
            bpy.data.objects.remove(o)
else:                                             # one GLB with every clip (each on an NLA track too: those would mix in)
    for t in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(t)
    find = lambda key: next(a for a in bpy.data.actions if a.name.startswith(key))
    run = find(CFG["run"])
    actions = {"run": run, "die": find(CFG["die"]), "rest": find("Armature|clip0|baselayer")}
for a in actions.values():
    a.use_fake_user = True
root = bpy.data.objects.new(f"{UNIT.capitalize()}_Root", None)
col.objects.link(root)
rig.parent = root


def use(action, frame):
    rig.animation_data.action = action
    if getattr(action, "slots", None) and len(action.slots):   # Blender 4.4+ action slots
        rig.animation_data.action_slot = action.slots[0]
    scene.frame_set(int(frame))


def bone(name):
    return rig.matrix_world @ rig.pose.bones[f"mixamorig:{name}"].head


def hips_at(action, frame):
    """Where the hips are (x, y) with the root untouched."""
    root.matrix_world = Matrix.Identity(4)
    use(action, frame)
    h = bone("Hips")
    return Vector((h.x, h.y, 0))


def place(angle, offset):
    """Turn him by `angle` (radians, about the origin), then move by `offset`."""
    root.matrix_world = Matrix.Translation(offset) @ Matrix.Rotation(angle, 4, "Z")
    bpy.context.view_layer.update()


def append_mesh(path, name=None):
    """The (named, else first) mesh object of a .blend, linked into the scene."""
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [name] if name else src.objects
    obj = next(o for o in dst.objects if o and o.type == "MESH")
    col.objects.link(obj)
    return obj


def decimate(obj, ratio):
    dec = obj.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = ratio
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        bpy.ops.object.modifier_apply(modifier="Decimate")


def mesh_box(objs):
    """World-space bounding box (min, max) of these meshes as they are posed now."""
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        pts += [o.matrix_world @ v.co for v in m.vertices]
        e.to_mesh_clear()
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


def hand_matrix():
    return rig.matrix_world @ rig.pose.bones["mixamorig:RightHand"].matrix


# --- the rifle: appended, decimated, origin at its grip ----------------------------------------------------------------
rifle = None
if "rifle" in CFG:
    with bpy.data.libraries.load(CFG["rifle"], link=False) as (src, dst):
        dst.objects = ["Mesh_0"]
    rifle = dst.objects[0]
    col.objects.link(rifle)
    rifle.name = rifle.data.name = "Rifle"
    decimate(rifle, 0.025)                        # it is a few pixels in game
    rs = RIFLE_LENGTH / rifle.dimensions.x
    rifle.data.transform(Matrix.Scale(rs, 4) @ Matrix.Translation(-GRIP))
    MUZZLE_LOCAL = (MUZZLE_TIP - GRIP) * rs


def palm():
    hand = rig.pose.bones["mixamorig:RightHand"]
    return rig.matrix_world @ hand.matrix @ Vector((0, 5.0, 0))   # a little way down the hand (the rig is in cm)


def aim_rifle():
    """Grip in the right hand, barrel (its -X) through the left, magazine down."""
    barrel = (bone("LeftHand") - bone("RightHand")).normalized()
    x = -barrel
    z = (Vector((0, 0, 1)) - x * x.z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = palm()
    rifle.matrix_world = m


def carry_rifle():
    """Following the right hand, pointing the way he faces (the body's -Y)."""
    rot = root.matrix_world.to_quaternion().to_matrix().to_4x4()
    rifle.matrix_world = Matrix.Translation(palm()) @ rot @ Matrix.Rotation(math.radians(90), 4, "Z")


# --- the standing model: fitted onto the rig's rest pose (it is that pose, remeshed at another size and spot) ----------
stand = None
if "stand" in CFG:
    stand = append_mesh(CFG["stand"])
    root.matrix_world = Matrix.Identity(4)
    use(actions["rest"], 0)
    lo, hi = mesh_box(body)
    slo, shi = mesh_box([stand])
    k = (hi.z - lo.z) / (shi.z - slo.z)
    mid, smid = (lo + hi) / 2, (slo + shi) / 2
    stand.data.transform(Matrix.Translation(Vector((mid.x, mid.y, lo.z))) @ Matrix.Scale(k, 4) @ Matrix.Translation(-Vector((smid.x, smid.y, slo.z))))
    stand.parent = root
    print(f"standing model scaled {k:.3f} onto the rest pose {tuple(round(c, 2) for c in hi - lo)}")


def show_standing(on):
    stand.hide_render = not on
    for o in body:
        o.hide_render = on


# --- a held prop: appended, decimated, origin at its grip; gripped like a pistol, its top along the thumb ---------------
held = None
if "held" in CFG:
    h = CFG["held"]
    held = append_mesh(h["blend"])
    decimate(held, 0.01)                          # half a million vertices; it is a few pixels in game
    hs = h["length"] / held.dimensions.z
    held.data.transform(Matrix.Scale(hs, 4) @ Matrix.Translation(-Vector(h["grip"])))
    # in the hand bone's frame: its Y runs along the fingers, -Z along the thumb and +X out of the palm
    HOLD_IN_HAND = Matrix(((0, 1, 0), (0, 0, -1), (-1, 0, 0))).transposed().to_4x4()


def grip_held():
    """In the right hand, a little way down from the wrist."""
    hand = hand_matrix()
    rot = hand.to_3x3().normalized().to_4x4()
    fingers = (rot @ Vector((0, 1, 0, 0))).to_3d()
    held.matrix_world = Matrix.Translation(hand.translation + fingers * 0.07) @ rot @ HOLD_IN_HAND


RUN_FWD = -math.pi / 2                            # Meshy characters run facing -Y
if rifle:
    # the aim: the rifle runs from the right hand to the left
    use(actions["aim"], HOLD)
    aim_vec = bone("LeftHand") - bone("RightHand")
    AIM = math.atan2(aim_vec.y, aim_vec.x)
    HOLD_HIPS = hips_at(actions["aim"], HOLD)
    print(f"aim {math.degrees(AIM):.1f} deg, hold hips {tuple(round(c, 2) for c in HOLD_HIPS)}")

# --- light and render settings (as the other sprites) ----------------------------------------------------------------
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
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.use_persistent_data = True
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100
bpy.ops.mesh.primitive_plane_add(size=16)
bpy.context.active_object.is_shadow_catcher = True

cam = bpy.data.objects.new("Camera_Sprite", bpy.data.cameras.new("Camera_Sprite"))
col.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.sensor_fit = "HORIZONTAL"
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
crot = cam.rotation_euler.to_matrix()
RIGHT, UP, FWD = crot @ Vector((1, 0, 0)), crot @ Vector((0, 1, 0)), crot @ Vector((0, 0, -1))
light_dir = (sun.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()


def canvas(radius, height, ppu=PPU):
    """Frame a box this size around the origin, plus its shadow; returns size, anchor and a world -> pixel map."""
    box = [Vector((x, y, z)) for x in (-radius, radius) for y in (-radius, radius) for z in (0, height)]
    box += [p + light_dir * (p.z / -light_dir.z) for p in box if p.z > 0]
    pad = 4
    us, vs = [p.dot(RIGHT) for p in box], [p.dot(UP) for p in box]
    u0, v0 = min(us) - pad / ppu, min(vs) - pad / ppu
    w = math.ceil((max(us) - min(us)) * ppu) + 2 * pad
    h = math.ceil((max(vs) - min(vs)) * ppu) + 2 * pad
    u1, v1 = u0 + w / ppu, v0 + h / ppu

    def use_canvas():
        scene.render.resolution_x, scene.render.resolution_y = w, h
        cam.data.ortho_scale = w / ppu
        cam.location = RIGHT * (u0 + u1) / 2 + UP * (v0 + v1) / 2 - FWD * 30

    to_px = lambda p: (round((p.dot(RIGHT) - u0) * ppu, 1), round((v1 - p.dot(UP)) * ppu, 1))
    return w, h, to_px, use_canvas


def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def pose_standing(face):
    """The standing model facing `face` (radians), the rig in its rest pose under it (for the hand)."""
    place(face - RUN_FWD, Vector())
    use(actions["rest"], 0)
    show_standing(True)
    if held:
        grip_held()


# --- stance and run ----------------------------------------------------------------------------------------------------
W, H, to_px, use_canvas = canvas(1.0, 1.9)
use_canvas()
anchor = dict(zip("xy", to_px(Vector((0, 0, 0)))))
stance = ("idle", "aim", HOLD) if rifle else ("idle", "stand", 0)
poses = [stance] + [(str(i), "run", run.frame_range[0] + round(i * (run.frame_range[1] - run.frame_range[0]) / RUN_FRAMES)) for i in range(RUN_FRAMES)]
muzzle = []
for d in range(DIRS):
    if QUICK and d not in (0, 6):
        continue
    face = math.radians(d * 360 / DIRS)
    for name, act, f in poses:
        if act == "aim":
            turn = face - AIM
            place(turn, -(Matrix.Rotation(turn, 4, "Z") @ HOLD_HIPS))
            use(actions["aim"], f)
            aim_rifle()
            muzzle.append(dict(zip("xy", to_px(rifle.matrix_world @ MUZZLE_LOCAL))))
        elif act == "stand":
            pose_standing(face)
        else:
            place(face - RUN_FWD, Vector())
            use(actions["run"], f)
            if stand:
                show_standing(False)
            if rifle:
                carry_rifle()
            if held:
                grip_held()
        render(os.path.join(FRAMES_DIR, f"inf_{d}_{name}.png"))
if QUICK:
    print("QUICK anchor", anchor, "muzzles", muzzle)
    print("DONE quick")
    sys.exit(0)

# --- death ------------------------------------------------------------------------------------------------------------
die = actions["die"]
if stand:
    show_standing(False)
start = hips_at(die, DEATH_START)
picks = [DEATH_START + round(i * (DEATH_END - DEATH_START) / (DEATH_FRAMES - 1)) for i in range(DEATH_FRAMES)]
throw_max = max((hips_at(die, f) - start).length for f in picks) * THROW
DW, DH, to_px_d, use_canvas_d = canvas(throw_max + 1.0, 1.9, DEATH_RES * 128 / (METRES_PER_TILE * math.sqrt(2)))
use_canvas_d()
danchor = dict(zip("xy", to_px_d(Vector((0, 0, 0)))))
for d in range(DIRS):
    turn = math.radians(d * 360 / DIRS) - RUN_FWD
    R = Matrix.Rotation(turn, 4, "Z")
    hold = None                                   # the rifle's hold on the hand, from the first frame
    for c, f in enumerate(picks):
        h = hips_at(die, f)
        place(turn, R @ ((h - start) * THROW - h))
        use(die, f)
        if rifle:
            if hold is None:
                carry_rifle()
                hold = hand_matrix().inverted() @ rifle.matrix_world
            rifle.matrix_world = hand_matrix() @ hold
        if held:
            grip_held()
        render(os.path.join(FRAMES_DIR, f"inf_{d}_die_{c}.png"))

# --- the card view: standing, bigger ----------------------------------------------------------------------------------
if CFG.get("card"):
    canvas(1.0, 1.9, CARD_SCALE * 128 / (METRES_PER_TILE * math.sqrt(2)))[3]()
    pose_standing(math.radians(CARD_DIR * 360 / DIRS))
    render(os.path.join(FRAMES_DIR, "card.png"))

json.dump({
    UNIT: {"res": RES, "w": W, "h": H, "anchor": anchor, "directions": DIRS, "run_frames": RUN_FRAMES, **({"muzzle": muzzle} if rifle else {}),
           "frames": [f"inf_{d}_{name}" for d in range(DIRS) for name, _, _ in poses]},
    f"{UNIT}_death": {"res": DEATH_RES, "w": DW, "h": DH, "anchor": danchor, "directions": DIRS, "death_frames": DEATH_FRAMES,
                      "fps": round(24 * (DEATH_FRAMES - 1) / (DEATH_END - DEATH_START), 2),
                      "frames": [f"inf_{d}_die_{c}" for d in range(DIRS) for c in range(DEATH_FRAMES)]},
}, open(os.path.join(FRAMES_DIR, "frames.json"), "w"), indent=1)
print(f"DONE {UNIT}")
