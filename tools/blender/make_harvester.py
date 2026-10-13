"""Harvester: split the Meshy vehicle's wheels out so they spin, then render game sprites.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b --disable-autoexec \
        ~/Downloads/Meshy_AI_sci_fi_mining_vehicle_1010035155_image-to-3d-texture.blend -P make_harvester.py
Saves harvester.blend (wheels as separate objects, spinning via a driver on the frame number)
and writes game/assets/harvester.{png,json}: 16 driving directions x 8 wheel frames.
Set REUSE_FRAMES=1 to keep already-rendered good frames (black ones are always re-rendered).

The Meshy mesh is one fused piece. Wheels were located by ray-casting: 3 per side at
x = 0.11 / 0.42 / 0.74, centre z = -0.258, radius ~0.12, tyre spanning |y| 0.20-0.38.
Faces fully inside that cylinder become a wheel object pivoting on its axle (UVs kept).

Sprite conventions (match the refinery): 2x art, tile = 0.4759 units = 128 px wide,
camera 45 deg yaw / 30 deg down, same sun and world. Direction d points the vehicle's nose
(local -X) at world angle d * 22.5 deg, counter-clockwise from +X seen from above.
"""
import json
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(OUT_DIR, "..", "..", "apps", "game", "public", "assets", "sprites")   # the game reads sprites from here
FRAMES_DIR = os.path.join(OUT_DIR, "frames")   # raw per-frame renders (gitignored)
os.makedirs(FRAMES_DIR, exist_ok=True)

TILE = 0.4759
PPU = 128 / (TILE * math.sqrt(2))
LENGTH_TILES = 1.5                         # harvester length in tiles (classic RTS proportions)
WHEEL_X, WHEEL_Z, WHEEL_R = (0.11, 0.42, 0.74), -0.258, 0.122
Y_IN, Y_OUT = 0.20, 0.42
DIRS, WHEEL_FRAMES = 16, 8
SPIN_PER_FRAME = 2 * math.pi / 24          # 1 wheel turn per second at 24 fps

scene = bpy.context.scene
col = scene.collection
body = bpy.data.objects["Mesh_0"]
body.name = body.data.name = "Harvester_Body"
me = body.data
mat = me.materials[0]

# --- Split wheels out of the fused mesh -----------------------------------------------
co = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)
loop_vert = np.empty(len(me.loops), dtype=np.int64)
me.loops.foreach_get("vertex_index", loop_vert)
loop_start = np.empty(len(me.polygons), dtype=np.int64)
loop_total = np.empty(len(me.polygons), dtype=np.int64)
me.polygons.foreach_get("loop_start", loop_start)
me.polygons.foreach_get("loop_total", loop_total)
assert (loop_total == 3).all(), "expected a triangulated Meshy mesh"
tri_loops = loop_start[:, None] + np.arange(3)
tris = loop_vert[tri_loops]
uv = np.empty(len(me.loops) * 2)
me.uv_layers[0].data.foreach_get("uv", uv)
uv = uv.reshape(-1, 2)

root = bpy.data.objects.new("Harvester", None)
col.objects.link(root)
body.parent = root
wheels, remove = [], np.zeros(len(me.polygons), dtype=bool)
for side in (-1, 1):
    for x in WHEEL_X:
        inside = (((co[:, 0] - x) ** 2 + (co[:, 2] - WHEEL_Z) ** 2 < WHEEL_R ** 2)
                  & (side * co[:, 1] > Y_IN) & (side * co[:, 1] < Y_OUT))
        faces = np.nonzero(inside[tris].all(axis=1))[0]
        used = np.unique(tris[faces])
        remap = np.full(len(co), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        centre = Vector((x, side * (Y_IN + Y_OUT) / 2, WHEEL_Z))
        name = f"Wheel_{'L' if side < 0 else 'R'}{WHEEL_X.index(x) + 1}"
        wm = bpy.data.meshes.new(name)
        wm.from_pydata((co[used] - np.array(centre)).tolist(), [], remap[tris[faces]].tolist())
        wm.uv_layers.new(name=me.uv_layers[0].name).data.foreach_set("uv", uv[tri_loops[faces]].ravel())
        wm.materials.append(mat)
        wm.shade_smooth()
        w = bpy.data.objects.new(name, wm)
        col.objects.link(w)
        w.parent = root
        w.location = centre
        # Spin with the timeline: driver on the frame number (simple expression, no autoexec needed)
        drv = w.driver_add("rotation_euler", 1).driver
        drv.type = "SCRIPTED"
        drv.expression = f"-frame * {SPIN_PER_FRAME:.6f}"
        wheels.append(w)
        remove[faces] = True
        print(f"{name}: {len(faces)} faces")

bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.nonzero(remove)[0]], context="FACES")
bm.to_mesh(me)
bm.free()

# Game scale, wheels resting on the ground plane
s = LENGTH_TILES * TILE / body.dimensions.x
root.scale = (s, s, s)
root.location.z = 0.376 * s
scene.frame_start, scene.frame_end = 1, 96
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "harvester.blend"))

# --- Lighting and render setup matching the refinery sprites ---------------------------
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
col.objects.link(sun)
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type == "METAL"
scene.cycles.device = "GPU"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.use_persistent_data = True
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100

bpy.ops.mesh.primitive_plane_add(size=6)
catcher = bpy.context.active_object
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


def set_direction(d):
    root.rotation_euler.z = math.radians(d * 360 / DIRS) - math.pi   # nose (-X) -> d * 22.5 deg


# One canvas for every direction so the anchor never moves
pts = []
for d in range(DIRS):
    set_direction(d)
    bpy.context.view_layer.update()
    corners = [body.matrix_world @ Vector(c) for c in body.bound_box]
    pts += corners + [p + light_dir * (p.z / -light_dir.z) for p in corners]
pad = 6
us, vs = [p.dot(RIGHT) for p in pts], [p.dot(UP) for p in pts]
u0, v0 = min(us) - pad / PPU, min(vs) - pad / PPU
W = math.ceil((max(us) - min(us)) * PPU) + 2 * pad
H = math.ceil((max(vs) - min(vs)) * PPU) + 2 * pad
u1, v1 = u0 + W / PPU, v0 + H / PPU
scene.render.resolution_x, scene.render.resolution_y = W, H
cam.data.ortho_scale = W / PPU
cam.location = RIGHT * (u0 + u1) / 2 + UP * (v0 + v1) / 2 - FWD * 30
ANCHOR = (round((0 - u0) * PPU, 1), round((v1 - 0) * PPU, 1))      # ground point under the centre

# --- Render 16 directions x 8 wheel frames, pack into one atlas -------------------------
step = round((2 * math.pi / WHEEL_FRAMES) / SPIN_PER_FRAME)          # timeline frames per wheel frame
sheet = np.zeros((DIRS * H, WHEEL_FRAMES * W, 4), dtype=np.float32)
frames = {}
for d in range(DIRS):
    set_direction(d)
    for f in range(WHEEL_FRAMES):
        scene.frame_set(f * step)
        path = os.path.join(FRAMES_DIR, f"harv_{d:02d}_{f}.png")
        scene.render.filepath = path
        for attempt in range(4):
            if not (attempt == 0 and os.environ.get("REUSE_FRAMES") and os.path.exists(path)):
                bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(path)
            px = np.empty(W * H * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            opaque = px.reshape(-1, 4)[:, 3] > 0.9
            # Metal occasionally drops the 4K textures mid-run and renders a black silhouette:
            # detect it and re-render without persistent data
            if opaque.any() and px.reshape(-1, 4)[opaque, :3].mean() > 0.05:
                break
            print(f"BLACK FRAME {d:02d}_{f}, re-rendering")
            scene.render.use_persistent_data = False
        scene.render.use_persistent_data = True
        y0 = (DIRS - 1 - d) * H                                       # bottom-up storage
        sheet[y0:y0 + H, f * W:(f + 1) * W] = px.reshape(H, W, 4)
        frames[f"harv_{d:02d}_{f}"] = {
            "frame": {"x": f * W, "y": d * H, "w": W, "h": H}, "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": W, "h": H}, "sourceSize": {"w": W, "h": H}}
img = bpy.data.images.new("harvester_sheet", WHEEL_FRAMES * W, DIRS * H, alpha=True)
img.pixels.foreach_set(sheet.ravel())
img.filepath_raw = os.path.join(ASSETS, "harvester.png")
img.file_format = "PNG"
img.save()
with open(os.path.join(ASSETS, "harvester.json"), "w") as fh:
    json.dump({"frames": frames, "meta": {
        "image": "harvester.png", "size": {"w": WHEEL_FRAMES * W, "h": DIRS * H}, "scale": "1",
        "anchor": {"x": ANCHOR[0], "y": ANCHOR[1]}, "directions": DIRS, "wheel_frames": WHEEL_FRAMES,
        "direction_0": "nose along world +X (grid +tx); directions turn counter-clockwise seen from above"}},
        fh, indent=1)
print(f"PACKED harvester: {DIRS}x{WHEEL_FRAMES} frames of {W}x{H}, anchor {ANCHOR}")
