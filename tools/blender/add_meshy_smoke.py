"""Add baked Mantaflow exhaust smoke to meshy_refinery.blend (run after add_meshy_door.py).

Run: /Applications/Blender.app/Contents/MacOS/Blender -b --disable-autoexec meshy_refinery.blend -P add_meshy_smoke.py
Bakes frames 1-160 into ./smoke_cache and saves the .blend in place, plus smoke_preview_*.png.

Stack openings were found by ray-casting the Meshy mesh from above:
twin utility stacks at (-0.695, 0.39) and (-0.575, 0.39), rim z -0.035;
core stack at (0.156, 0.205), rim z 0.42.
"""
import math
import os

import bpy
from mathutils import Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
scene = bpy.context.scene
col = scene.collection
FRAMES = (1, 160)

STACKS = [  # (name, x, y, rim z, emitter radius, smoke colour, density)
    ("Smoke_Core", 0.156, 0.205, 0.42, 0.04, (0.9, 0.9, 0.92), 1.0),
    ("Smoke_UtilityA", -0.695, 0.39, -0.035, 0.036, (0.85, 0.86, 0.88), 1.0),
    ("Smoke_UtilityB", -0.575, 0.39, -0.035, 0.036, (0.85, 0.86, 0.88), 1.0),
]

# --- Domain -------------------------------------------------------------------
lo, hi = Vector((-0.9, 0.05, -0.1)), Vector((0.75, 0.75, 1.4))
bpy.ops.mesh.primitive_cube_add(size=1, location=(lo + hi) / 2)
domain = bpy.context.active_object
domain.name = "Smoke_Domain"
domain.scale = hi - lo
bpy.ops.object.transform_apply(scale=True)
# Keep the default TEXTURED display: BOUNDS stops Material Preview from drawing the smoke
mod = domain.modifiers.new("Fluid", "FLUID")
mod.fluid_type = "DOMAIN"
ds = mod.domain_settings
ds.domain_type = "GAS"
ds.resolution_max = 128
ds.use_adaptive_domain = True
ds.alpha = 1.2                # density buoyancy
ds.beta = 0.6                 # heat buoyancy
ds.vorticity = 0.25
ds.use_dissolve_smoke = True
ds.dissolve_speed = 140
ds.display_thickness = 6.0   # make it clearly visible in Solid view too
ds.cache_type = "ALL"
ds.cache_directory = "//smoke_cache"
ds.cache_frame_start, ds.cache_frame_end = FRAMES

# Volume shader reading the simulated density and colour grids
smoke_mat = bpy.data.materials.new("Smoke_Volume")
smoke_mat.use_nodes = True
nt = smoke_mat.node_tree
nt.nodes.remove(nt.nodes["Principled BSDF"])
vol = nt.nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Density"].default_value = 16.0
vol.inputs["Absorption Color"].default_value = (0.85, 0.85, 0.87, 1)   # white steam, not soot
vol.inputs["Density Attribute"].default_value = "density"
vol.inputs["Color Attribute"].default_value = "color"
nt.links.new(vol.outputs["Volume"], nt.nodes["Material Output"].inputs["Volume"])
domain.data.materials.append(smoke_mat)

# --- Emitters at each stack opening -------------------------------------------
for name, x, y, z, r, color, density in STACKS:
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.03, vertices=16, location=(x, y, z + 0.01))
    em = bpy.context.active_object
    em.name = name
    em.display_type = "WIRE"
    em.hide_render = True
    fm = em.modifiers.new("Fluid", "FLUID")
    fm.fluid_type = "FLOW"
    fs = fm.flow_settings
    fs.flow_type = "SMOKE"
    fs.flow_behavior = "INFLOW"
    fs.flow_source = "MESH"
    fs.smoke_color = color
    fs.density = density
    fs.temperature = 1.5
    fs.use_initial_velocity = True
    fs.velocity_coord = (0.0, 0.0, 0.6)

# Light breeze so the plumes drift instead of rising as straight columns
bpy.ops.object.effector_add(type="WIND", location=(-1.2, 0.4, 0.6), rotation=(0, math.radians(90), 0))
wind = bpy.context.active_object
wind.name = "Smoke_Wind"
wind.field.strength = 0.4
wind.field.noise = 0.3

# --- Bake and save ---------------------------------------------------------------
bpy.ops.wm.save_mainfile()
with bpy.context.temp_override(object=domain, active_object=domain, selected_objects=[domain]):
    bpy.ops.fluid.bake_all()
bpy.ops.wm.save_mainfile()

# --- Preview renders (EEVEE) from the RTS camera and from the front ---------------
scene.render.resolution_x, scene.render.resolution_y = 1100, 1000
scene.camera = bpy.data.objects["Camera_RTS"]
bpy.data.objects["Camera_RTS"].data.ortho_scale = 3.0
for frame in (60, 120):
    scene.frame_set(frame)
    scene.render.filepath = os.path.join(OUT_DIR, f"smoke_preview_rts_f{frame}.png")
    bpy.ops.render.render(write_still=True)
front = bpy.data.objects.new("Camera_Front", bpy.data.cameras.new("Camera_Front"))
col.objects.link(front)
front.data.type = "ORTHO"
front.data.ortho_scale = 2.6
front.location = (0, -10, 0.35)
front.rotation_euler = (math.radians(90), 0, 0)
scene.camera = front
scene.frame_set(120)
scene.render.filepath = os.path.join(OUT_DIR, "smoke_preview_front_f120.png")
bpy.ops.render.render(write_still=True)
scene.camera = bpy.data.objects["Camera_RTS"]
bpy.ops.wm.save_mainfile()
