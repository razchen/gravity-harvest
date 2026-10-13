"""Render game sprites for the Meshy refinery: door animation + looping exhaust smoke.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b --disable-autoexec meshy_refinery.blend -P render_sprites.py
(set REUSE_FRAMES=1 to repack existing frames without re-rendering)
Writes game/assets/refinery_door.{png,json} and game/assets/refinery_smoke.{png,json}
(Phaser / TexturePacker "JSON Hash" atlases). The .blend itself is not modified.

Projection: fixed orthographic camera, 45 deg yaw, 30 deg down, which maps the ground
grid to 2:1 diamonds. Art is rendered at 2x: one tile = 128 x 64 px.
The refinery covers 4 x 4 tiles. Each atlas's meta.anchor is the pixel where the centre
of the footprint (on the ground) sits, so the game can place the sprite on its tiles.

Layers (stacked in the game, all with transparent backgrounds):
  door  - building + door + baked ground shadow, 16 frames closed -> open
  smoke - smoke only, building held out so it passes behind correctly, 32-frame seamless loop
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "apps", "game", "public", "assets", "sprites")   # the game reads sprites from here
FRAMES_DIR = os.path.join(HERE, "frames")   # raw per-frame renders (gitignored)
os.makedirs(FRAMES_DIR, exist_ok=True)

TILE_PX = 128                      # tile diamond width at 2x (64 px in game at 1x)
FOOTPRINT = 4                      # tiles per side
scene = bpy.context.scene
building = bpy.data.objects["Mesh_0"]
doors = [bpy.data.objects["Door_Left"], bpy.data.objects["Door_Right"]]
domain = bpy.data.objects["Smoke_Domain"]
ctrl = bpy.data.objects["DoorControl"]
sun = bpy.data.objects["Sun"]

bb = [building.matrix_world @ Vector(c) for c in building.bound_box]
lo = Vector([min(v[i] for v in bb) for i in range(3)])
hi = Vector([max(v[i] for v in bb) for i in range(3)])
TILE = max(hi.x - lo.x, hi.y - lo.y) / FOOTPRINT          # world units per tile
PPU = TILE_PX / (TILE * math.sqrt(2))                      # pixels per world unit
ANCHOR = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
print(f"TILE={TILE:.4f} units  PPU={PPU:.1f}")

# --- Cycles, transparent film, GPU -------------------------------------------------
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type == "METAL"
scene.cycles.device = "GPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.use_persistent_data = True      # keep the 2M-face BVH between frames
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

# Shadow catcher so the building's ground shadow is baked into the sprite alpha
bpy.ops.mesh.primitive_plane_add(size=12, location=(ANCHOR.x, ANCHOR.y, lo.z + 0.001))
catcher = bpy.context.active_object
catcher.name = "ShadowCatcher"
catcher.is_shadow_catcher = True

# --- Sprite camera ------------------------------------------------------------------
cam = bpy.data.objects.new("Camera_Sprite", bpy.data.cameras.new("Camera_Sprite"))
scene.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.sensor_fit = "HORIZONTAL"
cam.data.clip_end = 200
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
rot = cam.rotation_euler.to_matrix()
RIGHT, UP, FWD = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, -1))


def frame_points(points, pad=10):
    """Fit the camera to points; return canvas size and the anchor's pixel position."""
    us, vs = [p.dot(RIGHT) for p in points], [p.dot(UP) for p in points]
    u0, u1 = min(us) - pad / PPU, max(us) + pad / PPU
    v0, v1 = min(vs) - pad / PPU, max(vs) + pad / PPU
    w, h = math.ceil((u1 - u0) * PPU), math.ceil((v1 - v0) * PPU)
    u1, v1 = u0 + w / PPU, v0 + h / PPU
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    cam.data.ortho_scale = w / PPU
    cam.location = RIGHT * (u0 + u1) / 2 + UP * (v0 + v1) / 2 - FWD * 60
    anchor = (round((ANCHOR.dot(RIGHT) - u0) * PPU, 1), round((v1 - ANCHOR.dot(UP)) * PPU, 1))
    return w, h, anchor


def render_range(prefix, start, end):
    paths = [os.path.join(FRAMES_DIR, f"{prefix}_{f:04d}.png") for f in range(start, end + 1)]
    if os.environ.get("REUSE_FRAMES") and all(os.path.exists(p) for p in paths):
        return paths                              # repack only, keep existing renders
    scene.frame_start, scene.frame_end, scene.frame_step = start, end, 1
    scene.render.filepath = os.path.join(FRAMES_DIR, prefix + "_####")
    bpy.ops.render.render(animation=True)
    return paths


def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)                    # rows bottom-up, as Blender stores them


def pack(name, frames, w, h, anchor, cols, fps, loop):
    """Pack equal-size frames into a grid sheet + Phaser-compatible JSON Hash atlas."""
    rows = math.ceil(len(frames) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    meta_frames = {}
    for i, px in enumerate(frames):
        c, r = i % cols, i // cols
        y0 = (rows - 1 - r) * h                   # bottom-up storage
        sheet[y0:y0 + h, c * w:(c + 1) * w] = px
        meta_frames[f"{name}_{i:02d}"] = {
            "frame": {"x": c * w, "y": r * h, "w": w, "h": h}, "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h}}
    img = bpy.data.images.new(name, cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = os.path.join(OUT, f"refinery_{name}.png")
    img.file_format = "PNG"
    img.save()
    atlas = {"frames": meta_frames,
             "meta": {"image": f"refinery_{name}.png", "size": {"w": cols * w, "h": rows * h}, "scale": "1",
                      "anchor": {"x": anchor[0], "y": anchor[1]}, "fps": fps, "loop": loop,
                      "tile_px": TILE_PX, "footprint_tiles": FOOTPRINT}}
    with open(os.path.join(OUT, f"refinery_{name}.json"), "w") as f:
        json.dump(atlas, f, indent=1)
    print(f"PACKED {name}: {len(frames)} frames {w}x{h} -> {cols * w}x{rows * h}, anchor {anchor}")


# --- Layer 1: building + door + shadow, 16 frames closed -> open ------------------------
light_dir = (sun.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
top = [Vector((x, y, hi.z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y)]
shadow_tips = [p + light_dir * ((p.z - lo.z) / -light_dir.z) for p in top]
dw, dh, danchor = frame_points(bb + shadow_tips)
domain.hide_render = True
ctrl.animation_data_clear()
for frame, value in ((1, 0.0), (16, 1.0)):
    ctrl["open"] = value
    ctrl.keyframe_insert('["open"]', frame=frame)
door_paths = render_range("door", 1, 16)
pack("door", [load_rgba(p) for p in door_paths], dw, dh, danchor, cols=4, fps=12, loop=False)

# --- Layer 2: smoke only, building held out, 32-frame crossfaded loop ---------------------
dbb = [domain.matrix_world @ Vector(c) for c in domain.bound_box]
sw, sh, sanchor = frame_points(dbb + bb)
domain.hide_render = False
catcher.hide_render = True
for obj in [building] + doors:
    obj.is_holdout = True
ctrl["open"] = 0.0
ctrl.animation_data_clear()
smoke = [load_rgba(p) for p in render_range("smoke", 81, 128)]   # settled plume, 48 frames
LOOP, FADE = 32, 16
looped = []
for i in range(LOOP):
    a = smoke[i]
    if i < FADE:                                   # blend the tail (frames 32..47) into the head
        t = i / FADE
        b = smoke[i + LOOP]
        pa, pb = a[..., :3] * a[..., 3:], b[..., :3] * b[..., 3:]
        alpha = b[..., 3:] * (1 - t) + a[..., 3:] * t
        rgb = (pb * (1 - t) + pa * t) / np.maximum(alpha, 1e-6)
        a = np.concatenate([rgb, alpha], axis=-1)
    looped.append(a)
pack("smoke", looped, sw, sh, sanchor, cols=7, fps=12, loop=True)   # keep sheets <= 4096 px
