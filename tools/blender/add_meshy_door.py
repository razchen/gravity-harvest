"""Add an animated sliding bay door to the Meshy refinery model.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b --disable-autoexec \
        ~/Downloads/Meshy_AI_flux_refinery_1010032152_image-to-3d-texture.blend -P add_meshy_door.py
Saves meshy_refinery.blend next to this script, plus door_closed/half/open.png previews.

The Meshy mesh is one fused piece with an open recess at the bay (x -0.02..0.25,
z -0.52..-0.36, back grille at y -0.35, jamb faces at y -0.43). Two door leaves sit
in that opening at y -0.40 and slide sideways into the solid jambs. "DoorControl"
has an "open" property (0 = closed, 1 = open) that drives both leaves.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
scene = bpy.context.scene
col = scene.collection

X0, X1 = -0.035, 0.265          # leaf span, overlapping the jambs a little
Z0, Z1 = -0.535, -0.345         # floor to just inside the lintel
Y = -0.40                       # door plane, between jamb face and back grille
T = 0.014                       # leaf thickness
MID = (X0 + X1) / 2
TRAVEL = 0.14                   # each leaf slides this far into its jamb


def material(name, color, rough, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = (*color, 1.0)
    return m


MAT = {
    "steel": material("Door_Steel", (0.05, 0.055, 0.06), 0.45, 0.6),
    "rib": material("Door_Rib", (0.12, 0.125, 0.13), 0.4, 0.7),
    "yellow": material("Door_Hazard", (0.75, 0.5, 0.05), 0.5),
    "glow": material("Door_Light", (0.05, 0.35, 1.0), 0.3, emit=4.0),
}


def leaf(name, x0, x1, meeting_x):
    """One door leaf: steel slab, horizontal ribs, yellow meeting edge, hazard foot, light strip."""
    bm = bmesh.new()
    pieces = []

    def block(lo, hi, mat):
        geom = bmesh.ops.create_cube(bm, size=1.0)
        size, center = Vector(hi) - Vector(lo), (Vector(hi) + Vector(lo)) / 2
        for v in geom["verts"]:
            v.co = Vector((v.co.x * size.x, v.co.y * size.y, v.co.z * size.z)) + center
        faces = {f for v in geom["verts"] for f in v.link_faces}
        pieces.append((faces, mat))

    front = Y - T / 2
    block((x0, Y - T / 2, Z0), (x1, Y + T / 2, Z1), "steel")
    for i in range(5):                                       # horizontal stiffener ribs
        z = Z0 + 0.04 + i * 0.03
        block((x0 + 0.01, front - 0.004, z), (x1 - 0.01, front, z + 0.008), "rib")
    edge = (meeting_x - 0.012, meeting_x) if meeting_x > x0 + 0.01 else (meeting_x, meeting_x + 0.012)
    block((edge[0], front - 0.006, Z0), (edge[1], front, Z1 - 0.01), "yellow")   # meeting edge
    block((x0, front - 0.005, Z0), (x1, front, Z0 + 0.025), "yellow")            # hazard foot
    for k in range(6):                                       # black chevrons on the foot
        cx = x0 + 0.012 + k * 0.024
        block((cx, front - 0.0065, Z0 + 0.003), (cx + 0.008, front - 0.005, Z0 + 0.022), "steel")
    glow_x = meeting_x - 0.03 if meeting_x > x0 + 0.01 else meeting_x + 0.022
    block((glow_x, front - 0.006, Z1 - 0.07), (glow_x + 0.008, front, Z1 - 0.02), "glow")

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    order = list(MAT)
    for key in order:
        mesh.materials.append(MAT[key])
    for faces, mat in pieces:
        for f in faces:
            f.material_index = order.index(mat)
    bm.to_mesh(mesh)
    bm.free()
    return obj


left = leaf("Door_Left", X0, MID, MID)
right = leaf("Door_Right", MID, X1, MID)

# Controller: one slider drives both leaves (simple driver expressions run without Python autoexec)
ctrl = bpy.data.objects.new("DoorControl", None)
col.objects.link(ctrl)
ctrl.empty_display_type = "SINGLE_ARROW"
ctrl.empty_display_size = 0.15
ctrl.location = (MID, Y - 0.1, Z1 + 0.05)
ctrl["open"] = 0.0
ctrl.id_properties_ui("open").update(min=0.0, max=1.0, soft_min=0.0, soft_max=1.0,
                                     description="0 = closed, 1 = fully open")
for obj, sign in ((left, -1), (right, 1)):
    fc = obj.driver_add("location", 0)
    drv = fc.driver
    drv.type = "SCRIPTED"
    var = drv.variables.new()
    var.name = "open"
    var.type = "SINGLE_PROP"
    var.targets[0].id = ctrl
    var.targets[0].data_path = '["open"]'
    drv.expression = f"open * {sign * TRAVEL}"

# Animation: closed -> open -> hold -> closed, 160 frames at 24 fps
for frame, value in ((1, 0.0), (30, 0.0), (70, 1.0), (110, 1.0), (150, 0.0)):
    ctrl["open"] = value
    ctrl.keyframe_insert('["open"]', frame=frame)
scene.frame_start, scene.frame_end = 1, 160
scene.render.fps = 24

# Light and an RTS-style camera so F12 renders something sensible
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
col.objects.link(sun)
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
if scene.world is None:
    scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1.0)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8

cam = bpy.data.objects.new("Camera_RTS", bpy.data.cameras.new("Camera_RTS"))
col.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.6
rts = Vector((1, -1, 1.15)).normalized()
cam.location = Vector((0, 0, -0.2)) + rts * 10
cam.rotation_euler = (-rts).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "AgX"

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "meshy_refinery.blend"))

# Verification renders: close-up on the bay at closed / half / open
close = bpy.data.objects.new("Camera_DoorCloseup", bpy.data.cameras.new("Camera_DoorCloseup"))
col.objects.link(close)
close.data.type = "ORTHO"
close.data.ortho_scale = 0.75
d = Vector((0.45, -1, 0.55)).normalized()
close.location = Vector((MID, -0.45, -0.44)) + d * 6
close.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
scene.camera = close
scene.render.resolution_x, scene.render.resolution_y = 900, 700
for name, frame in (("closed", 1), ("half", 50), ("open", 90)):
    scene.frame_set(frame)
    scene.render.filepath = os.path.join(OUT_DIR, f"door_{name}.png")
    bpy.ops.render.render(write_still=True)
