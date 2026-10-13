"""Rifleman: attach the Meshy rifle to the rigged Meshy soldier and render game sprites.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P make_soldier.py -- <soldier glb dir> <rifle .blend>
Saves soldier.blend (rig + rifle parented to the right hand, Walking and Running actions) and writes
game/assets/rifleman.{png,json}: 8 directions x (8 running frames + 1 idle).

The soldier faces -Y and walks in place (no root motion). The rifle's barrel points along its -X
with the pistol grip at about (0.55, 0, -0.2); it is scaled to ~0.85 m, its grip follows
mixamorig:RightHand (Copy Location) and it keeps the body's facing, barrel forward.

Sprite conventions match the vehicles and buildings (camera 45 deg yaw / 30 deg down, same sun),
with infantry exaggerated 2x for readability, rendered at 2x resolution (meta.res) for sharpness.
Direction d points the soldier at world angle d * 45 deg, counter-clockwise from +X seen from above
(the harvester uses the same convention with 16 steps). meta.muzzle[d] is the muzzle pixel in the
idle frame for direction d, for muzzle flashes.
"""
import glob
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

SOLDIER_DIR, RIFLE_BLEND = sys.argv[sys.argv.index("--") + 1:][:2]
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(OUT_DIR, "..", "..", "apps", "game", "public", "assets", "sprites")   # the game reads sprites from here
FRAMES_DIR = os.path.join(OUT_DIR, "frames")   # raw per-frame renders (gitignored)
os.makedirs(FRAMES_DIR, exist_ok=True)

METRES_PER_TILE = 4.75 / 3.0                     # infantry exaggerated 3x so they read at the default zoom
RES = 1.5                                        # rendered at 1.5x the art scale (sheet stays <= 4096 px)
PPU = RES * 128 / (METRES_PER_TILE * math.sqrt(2))
DIRS, RUN_FRAMES = 8, 8
RIFLE_LENGTH = 0.85
GRIP = Vector((0.55, 0.0, -0.2))                 # rifle-local grip point
MUZZLE = Vector((-0.95, 0.0, 0.05))              # rifle-local muzzle tip

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection

# --- Soldier: one rig + mesh, both actions ---------------------------------------------------
bpy.ops.import_scene.gltf(filepath=glob.glob(os.path.join(SOLDIER_DIR, "*Walking*.glb"))[0])
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
keep = {rig} | {o for o in bpy.data.objects if o.parent == rig}
walk = rig.animation_data.action
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=glob.glob(os.path.join(SOLDIER_DIR, "*Running*.glb"))[0])
run = next(a for a in bpy.data.actions if a.name.startswith("Running"))
for o in set(bpy.data.objects) - before:
    bpy.data.objects.remove(o)
for o in list(bpy.data.objects):                 # drop the stray icosphere helpers
    if o not in keep:
        bpy.data.objects.remove(o)
walk.name, run.name = "Walking", "Running"
for a in (walk, run):
    a.use_fake_user = True
rig.name = "Rifleman"


def use_action(action, frame):
    rig.animation_data.action = action
    slot = getattr(action, "slots", None)
    if slot and len(action.slots):                # Blender 4.4+ action slots
        rig.animation_data.action_slot = action.slots[0]
    scene.frame_set(int(frame))


# --- Rifle: append, decimate, attach to the right hand in the idle pose ------------------------
with bpy.data.libraries.load(RIFLE_BLEND, link=False) as (src, dst):
    dst.objects = ["Mesh_0"]
rifle = dst.objects[0]
col.objects.link(rifle)
rifle.name = rifle.data.name = "Rifle"
dec = rifle.modifiers.new("Decimate", "DECIMATE")
dec.ratio = 0.025                                 # ~860k -> ~21k faces: it is a few pixels in game
with bpy.context.temp_override(object=rifle, active_object=rifle, selected_objects=[rifle]):
    bpy.ops.object.modifier_apply(modifier="Decimate")
s = RIFLE_LENGTH / rifle.dimensions.x

use_action(walk, 0)                               # idle pose: feet together, arm hanging
hand = rig.pose.bones["mixamorig:RightHand"]
hand_w = rig.matrix_world @ hand.matrix
palm = hand_w @ Vector((0, 5.0, 0))               # a little way down the hand (rig is in cm)
# barrel (-X) forward (-Y), magazine down. The rifle follows the hand's position but keeps the body's
# facing: parented to the bone it would flip vertical as the arms pump while running.
rifle.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-GRIP))   # origin at the grip
rifle.parent = rig
rifle.matrix_world = Matrix.Translation(palm) @ Matrix.Rotation(math.radians(90), 4, "Z")
follow = rifle.constraints.new("COPY_LOCATION")
follow.target, follow.subtarget = rig, hand.name
follow.head_tail = min(1.0, 5.0 / hand.length)
print(f"rifle: {len(rifle.data.polygons)} faces, scale {s:.3f}")
MUZZLE_LOCAL = (MUZZLE - GRIP) * s                # muzzle relative to the grip origin

root = bpy.data.objects.new("Rifleman_Root", None)
col.objects.link(root)
rig.parent = root
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "soldier.blend"))

# --- Lighting and render setup (same as the other sprites) ------------------------------------
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
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100
bpy.ops.mesh.primitive_plane_add(size=6)
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


def set_direction(d):
    root.rotation_euler.z = math.radians(d * 360 / DIRS) + math.pi / 2   # soldier forward (-Y) -> d * 45 deg


# One canvas for every direction and frame: a box around the soldier plus its shadow
H, R = 1.9, 0.8
box = [Vector((x, y, z)) for x in (-R, R) for y in (-R, R) for z in (0, H)]
box += [p + light_dir * (p.z / -light_dir.z) for p in box if p.z > 0]
pad = 4
us, vs = [p.dot(RIGHT) for p in box], [p.dot(UP) for p in box]
u0, v0 = min(us) - pad / PPU, min(vs) - pad / PPU
W = math.ceil((max(us) - min(us)) * PPU) + 2 * pad
Hh = math.ceil((max(vs) - min(vs)) * PPU) + 2 * pad
u1, v1 = u0 + W / PPU, v0 + Hh / PPU
scene.render.resolution_x, scene.render.resolution_y = W, Hh
cam.data.ortho_scale = W / PPU
cam.location = RIGHT * (u0 + u1) / 2 + UP * (v0 + v1) / 2 - FWD * 30
to_px = lambda p: (round((p.dot(RIGHT) - u0) * PPU, 1), round((v1 - p.dot(UP)) * PPU, 1))
ANCHOR = to_px(Vector((0, 0, 0)))

run_len = int(run.frame_range[1] - run.frame_range[0])
poses = [("idle", walk, 0)] + [(str(i), run, run.frame_range[0] + round(i * run_len / RUN_FRAMES)) for i in range(RUN_FRAMES)]
cols = len(poses)
sheet = np.zeros((DIRS * Hh, cols * W, 4), dtype=np.float32)
frames, muzzle = {}, []
for d in range(DIRS):
    set_direction(d)
    for c, (name, action, f) in enumerate(poses):
        use_action(action, f)
        if name == "idle":
            muzzle.append(dict(zip("xy", to_px(rifle.matrix_world.to_translation() + rifle.matrix_world.to_quaternion() @ MUZZLE_LOCAL))))
        path = os.path.join(FRAMES_DIR, f"inf_{d}_{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(W * Hh * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        y0 = (DIRS - 1 - d) * Hh
        sheet[y0:y0 + Hh, c * W:(c + 1) * W] = px.reshape(Hh, W, 4)
        frames[f"inf_{d}_{name}"] = {"frame": {"x": c * W, "y": d * Hh, "w": W, "h": Hh}, "rotated": False,
                                     "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": W, "h": Hh},
                                     "sourceSize": {"w": W, "h": Hh}}
# pad to power-of-two so WebGL can mipmap it (clean downscaling when zoomed out)
pot = lambda n: 1 << (n - 1).bit_length()
SW, SH = pot(cols * W), pot(DIRS * Hh)
padded = np.zeros((SH, SW, 4), dtype=np.float32)
padded[SH - DIRS * Hh:, :cols * W] = sheet               # bottom-up storage: keep the sheet at the top
img = bpy.data.images.new("rifleman", SW, SH, alpha=True)
img.pixels.foreach_set(padded.ravel())
img.filepath_raw = os.path.join(ASSETS, "rifleman.png")
img.file_format = "PNG"
img.save()
with open(os.path.join(ASSETS, "rifleman.json"), "w") as fh:
    json.dump({"frames": frames, "meta": {
        "image": "rifleman.png", "size": {"w": SW, "h": SH}, "scale": "1", "res": RES,
        "anchor": dict(zip("xy", ANCHOR)), "directions": DIRS, "run_frames": RUN_FRAMES, "muzzle": muzzle,
        "direction_0": "facing world +X (grid +gx); directions turn counter-clockwise seen from above"}}, fh, indent=1)
print(f"PACKED rifleman: {DIRS}x{cols} frames of {W}x{Hh}, anchor {ANCHOR}")
