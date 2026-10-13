"""Flux Refinery: simplified RTS-style refinery built from the concept sheet.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P make_refinery.py
Outputs refinery.blend, refinery.glb and refinery_{iso,gameplay,front,top}.png (Cycles).
Axes: +X right, -Y front (ramp side), +Z up. 1 unit = 1 m. Base top sits at z = B.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
B = 0.35  # base plinth height

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection


# --- Materials: painted metal with procedural weathering (Cycles) --------------
# Every non-emissive material runs through one "Weathering" node group that adds
# colour/roughness variation, edge wear (convex-edge AO), cavity grime, vertical
# streaks, dirt near the ground and soot around the exhaust outlets.

STACK_TOPS = [(-8.6, 4.1, B + 6.2), (-1.7, -0.2, 10.8)]  # exhaust outlets (see stack() calls)


def _weathering_group():
    ng = bpy.data.node_groups.new("Weathering", "ShaderNodeTree")
    for name, kind in (("Color", "NodeSocketColor"), ("Roughness", "NodeSocketFloat"),
                       ("Metallic", "NodeSocketFloat"), ("Wear", "NodeSocketFloat"),
                       ("Grime", "NodeSocketFloat")):
        ng.interface.new_socket(name, in_out="INPUT", socket_type=kind)
    for name, kind in (("Color", "NodeSocketColor"), ("Roughness", "NodeSocketFloat"),
                       ("Metallic", "NodeSocketFloat"), ("Normal", "NodeSocketVector")):
        ng.interface.new_socket(name, in_out="OUTPUT", socket_type=kind)
    nodes, links = ng.nodes, ng.links

    def node(kind, **props):
        n = nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def feed(sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            links.new(v, sock)
        else:
            sock.default_value = v

    def op(operation, a, b=0.0):
        n = node("ShaderNodeMath", operation=operation)
        feed(n.inputs[0], a)
        feed(n.inputs[1], b)
        return n.outputs[0]

    def remap(v, a, b, c=0.0, d=1.0):
        n = node("ShaderNodeMapRange", clamp=True)
        feed(n.inputs["Value"], v)
        n.inputs["From Min"].default_value, n.inputs["From Max"].default_value = a, b
        n.inputs["To Min"].default_value, n.inputs["To Max"].default_value = c, d
        return n.outputs["Result"]

    def mix_rgb(f, a, b):
        n = node("ShaderNodeMix", data_type="RGBA", clamp_factor=True)
        feed(n.inputs[0], f)
        feed(n.inputs[6], a)
        feed(n.inputs[7], b)
        return n.outputs[2]

    def mix_f(f, a, b):
        n = node("ShaderNodeMix", data_type="FLOAT", clamp_factor=True)
        feed(n.inputs[0], f)
        feed(n.inputs[2], a)
        feed(n.inputs[3], b)
        return n.outputs[0]

    def vec(operation, a, b=None):
        n = node("ShaderNodeVectorMath", operation=operation)
        feed(n.inputs[0], a)
        if b is not None:
            feed(n.inputs[1], b)
        return n.outputs["Value" if operation == "LENGTH" else "Vector"]

    gi, go = node("NodeGroupInput"), node("NodeGroupOutput")
    pos = node("ShaderNodeNewGeometry").outputs["Position"]

    def noise(scale, detail=6.0, coords=None):
        n = node("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        feed(n.inputs["Vector"], pos if coords is None else coords)
        return n.outputs["Fac"]

    def ao(distance, inside):
        n = node("ShaderNodeAmbientOcclusion", inside=inside, only_local=inside, samples=8)
        n.inputs["Distance"].default_value = distance
        return n.outputs["AO"]

    # Edge wear: convex edges found with inside-AO, broken up with fine noise
    edge = op("SUBTRACT", 1.0, ao(0.022, True))
    wear = remap(op("ADD", edge, op("MULTIPLY", op("SUBTRACT", noise(14), 0.5), 0.5)), 0.4, 0.62)
    wear = op("MULTIPLY", wear, gi.outputs["Wear"])
    # Grime in cavities and contact areas, vertical rain streaks, dirt rising from the ground
    cavity = op("SUBTRACT", 1.0, ao(0.9, False))
    grime = remap(op("MULTIPLY", cavity, remap(noise(3), 0.3, 0.7, 0.5, 1.4)), 0.12, 0.6)
    streak = remap(noise(2.5, 4, vec("MULTIPLY", pos, (3.0, 3.0, 0.25))), 0.5, 0.72, 0.0, 0.45)
    sep = node("ShaderNodeSeparateXYZ")
    feed(sep.inputs[0], pos)
    dirt = op("MULTIPLY", remap(sep.outputs["Z"], 0.15, 1.8, 1.0, 0.0), remap(noise(1.8), 0.3, 0.65, 0.35, 1.0))
    grime, streak, dirt = (op("MULTIPLY", m, gi.outputs["Grime"]) for m in (grime, streak, dirt))
    # Soot: falls off with distance from each exhaust outlet, stretched vertically
    soot = 0.0
    for top in STACK_TOPS:
        dist = vec("LENGTH", vec("MULTIPLY", vec("SUBTRACT", pos, top), (1.0, 1.0, 0.55)))
        soot = op("MAXIMUM", soot, remap(dist, 0.6, 4.0, 1.0, 0.0))
    soot = op("MULTIPLY", soot, remap(noise(5), 0.3, 0.7, 0.55, 1.0))

    hsv = node("ShaderNodeHueSaturation")
    feed(hsv.inputs["Color"], gi.outputs["Color"])
    feed(hsv.inputs["Value"], remap(noise(0.8, 3), 0.3, 0.7, 0.93, 1.05))
    color = mix_rgb(wear, hsv.outputs["Color"], (0.36, 0.35, 0.33, 1.0))
    color = mix_rgb(op("MULTIPLY", grime, 0.6), color, (0.09, 0.075, 0.06, 1.0))
    color = mix_rgb(streak, color, (0.11, 0.09, 0.07, 1.0))
    color = mix_rgb(op("MULTIPLY", dirt, 0.8), color, (0.17, 0.135, 0.095, 1.0))
    color = mix_rgb(op("MULTIPLY", soot, 0.92), color, (0.012, 0.011, 0.01, 1.0))
    dusty = op("MAXIMUM", dirt, soot)
    rough = op("ADD", gi.outputs["Roughness"], op("MULTIPLY", op("SUBTRACT", noise(7), 0.5), 0.35))
    rough = mix_f(dusty, mix_f(wear, rough, 0.32), 0.93)
    metal = mix_f(dusty, mix_f(wear, gi.outputs["Metallic"], 0.95), 0.0)
    bump = node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.02
    feed(bump.inputs["Height"], noise(22, 4))

    for name, sock in (("Color", color), ("Roughness", rough), ("Metallic", metal),
                       ("Normal", bump.outputs["Normal"])):
        links.new(sock, go.inputs[name])
    return ng


WEATHERING = _weathering_group()


def material(name, color, rough=0.5, metal=0.0, wear=1.0, grime=1.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1.0)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    if emit:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
        bsdf.inputs["Roughness"].default_value = 0.2
        return m
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = WEATHERING
    g.inputs["Color"].default_value = (*color, 1.0)
    g.inputs["Roughness"].default_value = rough
    g.inputs["Metallic"].default_value = metal
    g.inputs["Wear"].default_value = wear
    g.inputs["Grime"].default_value = grime
    for out, inp in (("Color", "Base Color"), ("Roughness", "Roughness"),
                     ("Metallic", "Metallic"), ("Normal", "Normal")):
        nt.links.new(g.outputs[out], bsdf.inputs[inp])
    return m


M = {
    "panel": material("Paint_Industrial", (0.40, 0.385, 0.35), 0.5),
    "dark": material("Steel_Dark_Painted", (0.06, 0.065, 0.07), 0.45, 0.5),
    "mid": material("Steel_Gunmetal", (0.16, 0.17, 0.18), 0.4, 0.75, wear=0.7),
    "yellow": material("Paint_Hazard_Yellow", (0.78, 0.5, 0.03), 0.45, wear=1.3),
    "deck": material("Steel_Deck_Painted", (0.2, 0.2, 0.19), 0.7, 0.1),
    "chrome": material("Steel_Hydraulic", (0.62, 0.62, 0.6), 0.15, 1.0, wear=0.0, grime=0.4),
    "barrel": material("Paint_Barrel_Red", (0.3, 0.07, 0.035), 0.5, wear=1.4),
    "crate": material("Paint_Crate_Olive", (0.17, 0.19, 0.1), 0.6, wear=1.2),
    "glow": material("Emissive_Blue", (0.02, 0.25, 1.0), emit=2.5),
    "soot": material("Soot", (0.01, 0.01, 0.01), 0.95, wear=0.0),
}

# --- Primitive helpers (each piece is collected into a named part) ------------

PARTS = {}


def _add(part, bm, mat, bevel):
    mesh = bpy.data.meshes.new(part)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(part, mesh)
    col.objects.link(obj)
    obj.data.materials.append(M[mat])
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(40)
        dg = bpy.context.evaluated_depsgraph_get()
        baked = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        obj.modifiers.clear()
        obj.data = baked
    PARTS.setdefault(part, []).append(obj)
    return obj


def box(part, lo, hi, mat, bevel=0.06):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    size = Vector(hi) - Vector(lo)
    center = (Vector(hi) + Vector(lo)) / 2
    for v in bm.verts:
        v.co = Vector((v.co.x * size.x, v.co.y * size.y, v.co.z * size.z)) + center
    return _add(part, bm, mat, bevel)


def cyl(part, base, r, h, mat, r_top=None, seg=24, bevel=0.04, direction=(0, 0, 1)):
    seg = max(seg, 64) if r > 1.5 else max(seg, 32) if r > 0.4 else seg
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r,
                          radius2=r if r_top is None else r_top, depth=h)
    d = Vector(direction).normalized()
    m = Matrix.Translation(Vector(base) + d * h / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _add(part, bm, mat, bevel)


def hull(part, pts, mat, bevel=0.06):
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _add(part, bm, mat, bevel)


def slope(part, x0, x1, y0, y1, z_front, z_back, mat, bevel=0.08, z_bottom=0.0):
    """Wedge rising from z_front at y0 to z_back at y1."""
    pts = [(x, y, z_bottom) for x in (x0, x1) for y in (y0, y1)]
    pts += [(x, y0, z_front) for x in (x0, x1)] + [(x, y1, z_back) for x in (x0, x1)]
    return hull(part, pts, mat, bevel)


def rib(part, cx, cy, ang, r0, r1, w, z0, z1, mat, bevel=0.04):
    """Radial box hugging a cylinder at angle ang (degrees)."""
    d = Vector((math.cos(math.radians(ang)), math.sin(math.radians(ang)), 0))
    t = Vector((-d.y, d.x, 0))
    c = Vector((cx, cy, 0))
    pts = [c + d * r + t * s + Vector((0, 0, z)) for r in (r0, r1) for s in (-w / 2, w / 2) for z in (z0, z1)]
    return hull(part, pts, mat, bevel)


def pipe(part, pts, r, mat="dark", collar="yellow"):
    """Pipe along a polyline with 90-degree corners turned into rounded elbows.

    Couplings sit either side of every elbow, flanges at both ends and a painted
    band on long straight runs.
    """
    pts = [Vector(p) for p in pts]
    bend = r * 1.8
    path, runs, elbows = [pts[0]], [], []
    run_start = pts[0]
    for prev, c, nxt in zip(pts, pts[1:], pts[2:]):
        d1, d2 = (c - prev).normalized(), (nxt - c).normalized()
        a, b = c - d1 * bend, c + d2 * bend
        center = a + d2 * bend
        for k in range(9):
            t = math.radians(90) * k / 8
            path.append(center - d2 * bend * math.cos(t) + d1 * bend * math.sin(t))
        runs.append((run_start, a))
        elbows.append((a, d1, b, d2))
        run_start = b
    path.append(pts[-1])
    runs.append((run_start, pts[-1]))

    cu = bpy.data.curves.new("pipe", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    spline = cu.splines.new("POLY")
    spline.points.add(len(path) - 1)
    for p, co in zip(spline.points, path):
        p.co = (*co, 1.0)
    tmp = bpy.data.objects.new("pipe_tmp", cu)
    col.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)
    _add(part, bm, mat, 0)

    for a, d1, b, d2 in elbows:  # couplings either side of each elbow
        cyl(part, a - d1 * 0.18, r * 1.28, 0.18, "mid", seg=32, bevel=0.025, direction=d1)
        cyl(part, b, r * 1.28, 0.18, "mid", seg=32, bevel=0.025, direction=d2)
    for a, b in runs:  # painted band on long straight runs
        seg = b - a
        if seg.length > 1.6:
            cyl(part, a + seg / 2 - seg.normalized() * 0.18, r * 1.08, 0.36, collar,
                seg=32, bevel=0.02, direction=seg)
    for end, nxt in ((pts[0], pts[1]), (pts[-1], pts[-2])):  # end flanges
        e, d = Vector(end), (Vector(nxt) - Vector(end)).normalized()
        cyl(part, e + d * 0.02, r * 1.5, 0.22, "mid", seg=32, bevel=0.03, direction=d)
        cyl(part, e + d * 0.24, r * 1.25, 0.14, "dark", seg=32, bevel=0.02, direction=d)


def mirror_x(fn, *args, **kw):
    """Call a box-style helper for both +X and -X sides (lo/hi given for -X)."""
    lo, hi = Vector(args[1]), Vector(args[2])
    fn(args[0], lo, hi, *args[3:], **kw)
    fn(args[0], (-hi.x, lo.y, lo.z), (-lo.x, hi.y, hi.z), *args[3:], **kw)


# --- Layout (pass 2: ~20% wider, bigger core, shorter/wider tanks) ------------
# Footprint roughly 19 m (X) x 17.4 m (Y). Core drum centred at (0, CORE_Y).

CORE_Y, CORE_R = 1.4, 3.2
TANK_X, TANK_Y, TANK_R = 4.7, 5.8, 2.5
DOOR = 2.25  # half-width of the loading bay (25% wider than pass 1)

# --- Base ---------------------------------------------------------------------

box("base", (-11.0, -1.6, 0), (8.0, 8.8, B), "dark", 0.1)        # rear slab (tanks + utility)
box("base", (-6.1, -5.6, 0), (6.1, -1.6, B), "dark", 0.1)        # front slab (entrance)
box("base", (-11.0, -1.75, 0.06), (-6.1, -1.5, 0.29), "yellow", 0.03)
box("base", (6.1, -1.75, 0.06), (8.0, -1.5, 0.29), "yellow", 0.03)
mirror_x(box, "base", (-6.2, -5.6, 0.06), (-5.95, -1.6, 0.29), "yellow", 0.03)

# --- Ramp / loading bay approach ----------------------------------------------

slope("ramp", -DOOR, DOOR, -8.8, -5.6, 0.05, B, "deck", 0.03)
for s in (-1, 1):
    x0, x1 = sorted((s * DOOR, s * (DOOR + 0.45)))
    slope("ramp", x0, x1, -8.8, -4.4, 0.2, 0.6, "yellow", 0.04)            # curb
    x0, x1 = sorted((s * (DOOR + 0.45), s * 4.6))
    slope("ramp", x0, x1, -8.3, -4.4, 0.6, 3.1, "panel", 0.12)             # buttress
    x0, x1 = sorted((s * (DOOR + 0.75), s * 4.3))
    slope("ramp", x0, x1, -8.2, -4.5, 0.85, 3.35, "yellow", 0.06, z_bottom=0.5)  # buttress cap
mirror_x(box, "ramp", (-5.2, -5.0, 0), (-4.6, -4.3, 3.7), "dark", 0.06)    # flank pylons
mirror_x(box, "ramp", (-5.25, -5.05, 3.7), (-4.55, -4.25, 4.0), "yellow", 0.05)

# --- Central processing core --------------------------------------------------

core = "central_core"
# Entrance house
mirror_x(box, core, (-4.7, -4.4, B), (-DOOR, -0.6, 4.6), "panel", 0.15)  # piers
box(core, (-DOOR, -4.4, 3.4), (DOOR, -0.6, 4.6), "dark", 0.1)            # lintel
mirror_x(box, core, (-DOOR - 0.4, -4.6, B), (-DOOR, -4.05, 3.65), "yellow", 0.06)  # door frame
box(core, (-DOOR - 0.4, -4.6, 3.4), (DOOR + 0.4, -4.05, 3.8), "yellow", 0.06)
box(core, (-1.5, -4.48, 3.95), (1.5, -4.34, 4.25), "glow", 0)
box(core, (-DOOR, -2.4, B), (DOOR, -0.6, 3.4), "dark", 0.03)             # interior
box(core, (-1.95, -2.5, B), (1.95, -2.4, 3.1), "mid", 0.02)              # bay door
mirror_x(box, core, (-2.15, -2.48, 0.7), (-2.02, -2.38, 2.8), "glow", 0)
box(core, (-4.5, -4.2, 4.6), (4.5, -0.6, 5.1), "panel", 0.3)             # roof
box(core, (-2.3, -3.8, 5.1), (2.3, -1.6, 5.7), "panel", 0.15)            # roof processing block
mirror_x(box, core, (-4.75, -4.7, 3.6), (-3.2, -4.0, 4.75), "yellow", 0.12)  # shoulder plates
# Round processing drum (the dominant mass)
cyl(core, (0, CORE_Y, B), CORE_R, 6.0 - B, "panel", seg=32, bevel=0.06)
cyl(core, (0, CORE_Y, 4.2), CORE_R + 0.1, 0.6, "dark", seg=32)
cyl(core, (0, CORE_Y, 5.75), CORE_R + 0.06, 0.2, "yellow", seg=32, bevel=0.03)
cyl(core, (0, CORE_Y, 6.0), CORE_R, 1.2, "panel", r_top=2.1, seg=32)
cyl(core, (0, CORE_Y, 6.45), 2.8, 0.22, "dark", seg=32, bevel=0.03)
cyl(core, (0, CORE_Y, 7.2), 2.1, 0.3, "dark", r_top=1.8, seg=32)
cyl(core, (0, CORE_Y, 7.5), 1.15, 0.15, "glow", seg=24, bevel=0)         # top "eye"
# Front face of the core with the vertical light slit
box(core, (-3.0, -1.9, 4.6), (3.0, 0.6, 7.0), "panel", 0.3)
mirror_x(box, core, (-2.6, -2.02, 5.3), (-1.2, -1.8, 6.4), "dark", 0.06)
box(core, (-0.75, -2.15, 4.7), (0.75, -1.4, 7.8), "panel", 0.15)
box(core, (-0.45, -2.2, 5.0), (0.45, -2.1, 7.5), "dark", 0.04)
box(core, (-0.2, -2.26, 5.2), (0.2, -2.16, 7.3), "glow", 0)
# Side bulges
mirror_x(box, core, (-4.3, 0.2, B), (-2.7, 2.8, 4.4), "panel", 0.18)
mirror_x(box, core, (-4.4, 1.1, 1.0), (-4.25, 1.9, 4.0), "yellow", 0.03)

# --- Tanks (15% shorter, ~15% wider than pass 1) -------------------------------

def tank(part, x, y=TANK_Y, r=TANK_R):
    cyl(part, (x, y, B), r + 0.22, 0.45, "dark", seg=32, bevel=0.07)
    cyl(part, (x, y, 0.8), r + 0.05, 1.3, "dark", seg=32)
    cyl(part, (x, y, 2.1), r, 3.1, "panel", seg=32)
    cyl(part, (x, y, 2.1), r + 0.1, 0.2, "yellow", seg=32, bevel=0.03)
    cyl(part, (x, y, 3.7), r + 0.06, 0.15, "yellow", seg=32, bevel=0.03)
    cyl(part, (x, y, 5.2), r + 0.08, 0.5, "dark", seg=32)
    cyl(part, (x, y, 5.7), r, 0.5, "panel", r_top=1.4, seg=32)
    cyl(part, (x, y, 5.7), r + 0.1, 0.14, "yellow", seg=32, bevel=0.03)
    cyl(part, (x, y, 6.2), 0.9, 0.22, "dark", seg=20)
    for ang in (45, 135, 225, 315):
        rib(part, x, y, ang, r - 0.05, r + 0.32, 0.5, 0.8, 5.8, "dark", bevel=0.05)
    rib(part, x, y, 270, r, r + 0.12, 0.45, 1.1, 1.8, "glow", bevel=0)


tank("tank_left", -TANK_X)
tank("tank_right", TANK_X)

# --- Utility module -----------------------------------------------------------

u = "utility_module"
box(u, (-10.8, -1.1, B), (-6.5, 3.2, 3.6), "dark", 0.12)
box(u, (-10.5, -0.8, 3.6), (-6.8, 2.9, 4.0), "panel", 0.15)
box(u, (-10.0, -1.24, 1.15), (-7.3, -1.1, 1.4), "glow", 0)
box(u, (-10.95, -1.25, 0.6), (-10.6, -0.85, 3.3), "yellow", 0.05)
box(u, (-10.2, 5.0, B), (-7.6, 7.8, 2.2), "panel", 0.15)                 # rear crate
box(u, (-10.3, 4.9, 1.75), (-7.5, 7.9, 2.0), "dark", 0.05)

# --- Smokestacks: two thick stacks instead of four thin ones -------------------

def stack(x, y, z0, r, h, collar="mid"):
    s = "smokestacks"
    cyl(s, (x, y, z0), r, h, "dark", seg=24, bevel=0.05)
    cyl(s, (x, y, z0), r * 1.45, 0.5, "mid", seg=24, bevel=0.05)
    cyl(s, (x, y, z0 + h * 0.5), r * 1.22, 0.5, collar, seg=24, bevel=0.05)
    cyl(s, (x, y, z0 + h * 0.72), r * 1.06, 0.2, "glow", seg=24, bevel=0)
    cyl(s, (x, y, z0 + h - 0.45), r * 1.2, 0.5, "mid", seg=24, bevel=0.05)
    cyl(s, (x, y, z0 + h + 0.051), r * 0.85, 0.01, "soot", seg=24, bevel=0)
    for f in (0.25, 0.85):  # stiffener rings
        cyl(s, (x, y, z0 + h * f), r * 1.08, 0.12, "dark", seg=24, bevel=0.02)


stack(-8.6, 4.1, B, 0.8, 6.2)                       # utility exhaust
stack(-1.7, -0.2, 6.4, 0.65, 4.4, collar="yellow")  # core exhaust, front-left so it clears the left tank

# --- Large pipes: thicker, straight runs between modules -----------------------

p = "large_pipes"
pipe(p, [(0, 4.0, 4.6), (0, 8.0, 4.6), (0, 8.0, B)], 0.6)               # spine from core, between tanks
for s in (-1, 1):
    pipe(p, [(0, TANK_Y, 4.6), (s * (TANK_X - TANK_R + 0.2), TANK_Y, 4.6)], 0.5)  # spine -> tank
pipe(p, [(-4.0, 1.5, 1.9), (-6.7, 1.5, 1.9)], 0.6)                      # core -> utility
for y, z in ((1.9, 2.4), (0.6, 1.5)):                                    # core -> right-side outlet
    pipe(p, [(4.0, y, z), (7.2, y, z), (7.2, y, B)], 0.5)
box(p, (6.5, -0.2, B), (7.9, 2.7, 0.8), "dark", 0.08)

# --- Detail pass ----------------------------------------------------------------
# Sized for the gameplay camera (~30 px per metre): nothing thinner than ~0.12 m.

def hazard(part, origin, u, v, length, width, normal, stripe=0.35, gap=0.35, t=0.04):
    """45-degree yellow/black stripes filling origin + [0,length]*u + [0,width]*v."""
    o, u, v, n = (Vector(a).normalized() if i else Vector(a) for i, a in enumerate((origin, u, v, normal)))
    hull(part, [o + u * a + v * b + n * d for a in (0, length) for b in (0, width) for d in (0, t * 0.5)],
         "dark", 0)
    x = 0.0
    while x + stripe + width <= length:
        quad = [o + u * x, o + u * (x + stripe),
                o + u * (x + stripe + width) + v * width, o + u * (x + width) + v * width]
        hull(part, [p + n * d for p in quad for d in (0, t)], "yellow", 0)
        x += stripe + gap


def ramp_z(y):
    return 0.05 + (y + 8.8) * (B - 0.05) / 3.2


# Hazard markings: ramp lip, front apron, right service edge, bay door, utility skirt
slope_dir = Vector((0, 3.2, B - 0.05))
hazard("ramp", (-DOOR + 0.1, -8.7, ramp_z(-8.7) + 0.005), (1, 0, 0), slope_dir, 2 * DOOR - 0.2, 0.75,
       Vector((0, -(B - 0.05), 3.2)))
for x0 in (-6.0, 5.3):
    hazard("base", (x0, -5.5, B), (0, 1, 0), (1, 0, 0), 3.8, 0.7, (0, 0, 1))
hazard("base", (7.45, 3.0, B), (0, 1, 0), (1, 0, 0), 5.6, 0.5, (0, 0, 1))
hazard("base", (6.15, -1.5, B), (1, 0, 0), (0, 1, 0), 1.8, 0.55, (0, 0, 1))
hazard("central_core", (-1.9, -2.5, B + 0.05), (1, 0, 0), (0, 0, 1), 3.8, 0.6, (0, -1, 0))
hazard("utility_module", (-10.5, -1.1, B + 0.1), (1, 0, 0), (0, 0, 1), 3.9, 0.55, (0, -1, 0))

# Ramp: chunky tread bars and pylon light strips
for i in range(5):
    y = -8.1 + i * 0.6
    box("ramp", (-DOOR + 0.1, y, ramp_z(y)), (DOOR - 0.1, y + 0.18, ramp_z(y) + 0.07), "dark", 0)
mirror_x(box, "ramp", (-5.05, -5.08, 1.8), (-4.75, -4.98, 3.4), "glow", 0)

# Core: drum panel seams and emissive strips facing the camera
for ang in range(0, 360, 30):
    rib(core, 0, CORE_Y, ang, CORE_R - 0.02, CORE_R + 0.05, 0.12, B + 0.3, 4.2, "dark", bevel=0)
for ang in (-35, 0, 35):
    rib(core, 0, CORE_Y, ang + 15, CORE_R, CORE_R + 0.08, 0.28, 1.4, 3.8, "glow", bevel=0)
# Cap vents
for s in (-1, 1):
    x0, x1 = sorted((s * 1.9, s * 2.85))
    box(core, (x0, 0.7, 5.95), (x1, 2.1, 6.75), "panel", 0.08)
    for i in range(3):
        box(core, (x0 + 0.1, 0.85 + i * 0.42, 6.75), (x1 - 0.1, 1.07 + i * 0.42, 6.85), "dark", 0)
# Roof processing block grille
box(core, (-1.95, -3.5, 5.7), (1.95, -1.9, 5.72), "soot", 0)
for i in range(3):
    box(core, (-1.8, -3.4 + i * 0.5, 5.7), (1.8, -3.15 + i * 0.5, 5.85), "mid", 0.02)
# Pier side vents, seams and light strips (outer faces of the entrance house)
mirror_x(box, core, (-4.78, -3.6, 1.4), (-4.7, -1.4, 2.8), "soot", 0)
for i in range(4):
    z = 1.5 + i * 0.33
    mirror_x(box, core, (-4.84, -3.5, z), (-4.68, -1.5, z + 0.15), "mid", 0.02)
mirror_x(box, core, (-4.8, -4.2, 1.0), (-4.7, -3.9, 3.8), "glow", 0)
mirror_x(box, core, (-4.77, -4.4, 3.05), (-4.68, -0.6, 3.17), "dark", 0)
mirror_x(box, core, (-4.7, -4.48, 3.05), (-DOOR - 0.4, -4.38, 3.17), "dark", 0)
box(core, (-3.0, -1.98, 4.95), (3.0, -1.88, 5.07), "dark", 0)            # core face seam
# Side bulge roof vents
for s in (-1, 1):
    x0, x1 = sorted((s * 2.95, s * 4.05))
    box(core, (x0, 0.5, 4.4), (x1, 2.5, 4.6), "mid", 0.05)
    for i in range(3):
        box(core, (x0 + 0.1, 0.65 + i * 0.6, 4.6), (x1 - 0.1, 0.9 + i * 0.6, 4.7), "dark", 0)


# Tanks: braces, panel seams, access hatch, emissive strip and band
def tank_detail(part, x, y=TANK_Y, r=TANK_R):
    d = lambda a: Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
    for ang in (45, 135, 225, 315):
        dv, tv = d(ang), d(ang + 90)
        c = Vector((x, y, 0))
        pts = []
        for w in (-0.22, 0.22):
            pts += [c + dv * (r + 0.2) + tv * w + Vector((0, 0, B)),
                    c + dv * (r + 0.2) + tv * w + Vector((0, 0, 2.6)),
                    c + dv * (r + 1.05) + tv * w + Vector((0, 0, B))]
        hull(part, pts, "dark", 0.05)
    for ang in (0, 90, 180, 270):
        rib(part, x, y, ang, r - 0.02, r + 0.04, 0.12, 2.3, 5.2, "dark", bevel=0)
    rib(part, x, y, 337, r - 0.05, r + 0.08, 1.2, 0.75, 2.05, "yellow", bevel=0.02)
    rib(part, x, y, 337, r - 0.05, r + 0.14, 0.9, 0.85, 1.95, "mid", bevel=0.03)
    rib(part, x, y, 293, r, r + 0.09, 0.28, 2.5, 4.9, "glow", bevel=0)
    cyl(part, (x, y, 5.42), r + 0.1, 0.14, "glow", seg=32, bevel=0)
    for ang in (60, 240):  # roof access hatches on the cap ring
        p = Vector((x, y, 0)) + d(ang) * 1.75
        box(part, (p.x - 0.4, p.y - 0.4, 5.75), (p.x + 0.4, p.y + 0.4, 6.15), "mid", 0.05)


tank_detail("tank_left", -TANK_X)
tank_detail("tank_right", TANK_X)

# Utility: roof fan and hatch, big front grille
cyl(u, (-9.0, 1.1, 4.0), 0.95, 0.25, "mid", seg=24)
cyl(u, (-9.0, 1.1, 4.0), 0.75, 0.27, "soot", seg=24, bevel=0)
box(u, (-9.85, 1.0, 4.0), (-8.15, 1.2, 4.32), "dark", 0.02)
box(u, (-9.1, 0.25, 4.0), (-8.9, 1.95, 4.32), "dark", 0.02)
box(u, (-7.9, 0.1, 4.0), (-6.9, 1.9, 4.12), "yellow", 0.02)
box(u, (-7.8, 0.2, 4.0), (-7.0, 1.8, 4.22), "mid", 0.04)
box(u, (-10.2, -1.16, 1.6), (-7.1, -1.08, 2.9), "soot", 0)
for i in range(4):
    z = 1.7 + i * 0.3
    box(u, (-10.1, -1.24, z), (-7.2, -1.12, z + 0.15), "mid", 0.02)

# Pipe supports
box(p, (-5.65, 1.1, B), (-5.15, 1.9, 1.4), "dark", 0.05)
box(p, (5.4, 0.1, B), (5.9, 1.1, 1.0), "dark", 0.05)
box(p, (5.4, 1.4, B), (5.9, 2.4, 1.9), "dark", 0.05)

# Base corner lights
for x in (-6.1, 6.1):
    box("base", (x - 0.2, -5.7, 0.1), (x + 0.2, -5.55, 0.28), "glow", 0)

# --- Realism pass: layered paneling, industrial intake, tank structure ---------

def plate_grid(part, origin, u, v, normal, nu, nv, mat, gap=0.08, t=0.05, margin=0.1, bevel=0.02):
    """nu x nv raised plates covering the rectangle origin + [0,1]*u + [0,1]*v."""
    o, u, v, n = Vector(origin), Vector(u), Vector(v), Vector(normal).normalized()
    uh, vh = u.normalized(), v.normalized()
    du = (u.length - 2 * margin - (nu - 1) * gap) / nu
    dv = (v.length - 2 * margin - (nv - 1) * gap) / nv
    for i in range(nu):
        for j in range(nv):
            p = o + uh * (margin + i * (du + gap)) + vh * (margin + j * (dv + gap))
            hull(part, [p + uh * a + vh * b + n * c for a in (0, du) for b in (0, dv) for c in (0, t)],
                 mat, bevel)


def framed(part, origin, u, v, normal, frame_mat, inner_mat, w=0.14, t=0.08):
    """Recessed-looking access panel: thick raised frame around a thin inner plate."""
    o, n = Vector(origin), Vector(normal).normalized()
    uh, vh, U, V = Vector(u).normalized(), Vector(v).normalized(), Vector(u).length, Vector(v).length
    quad = lambda a0, a1, b0, b1, th: [o + uh * a + vh * b + n * c
                                       for a in (a0, a1) for b in (b0, b1) for c in (0, th)]
    hull(part, quad(w, U - w, w, V - w, t * 0.35), inner_mat, 0.01)
    for a0, a1, b0, b1 in ((0, U, 0, w), (0, U, V - w, V), (0, w, w, V - w), (U - w, U, w, V - w)):
        hull(part, quad(a0, a1, b0, b1, t), frame_mat, 0.02)


def mirrored(fn, part, origin, u, v, normal, *args, **kw):
    fn(part, origin, u, v, normal, *args, **kw)
    fx = lambda w: (-w[0], w[1], w[2])
    fn(part, fx(origin), fx(u), fx(v), fx(normal), *args, **kw)


def brace(part, cx, cy, ang, r_in, r_out, w, z_top, mat):
    """Triangular gusset standing on the base, leaning on a cylinder."""
    d = Vector((math.cos(math.radians(ang)), math.sin(math.radians(ang)), 0))
    t = Vector((-d.y, d.x, 0))
    c = Vector((cx, cy, 0))
    pts = []
    for s in (-w / 2, w / 2):
        pts += [c + d * r_in + t * s + Vector((0, 0, B)), c + d * r_in + t * s + Vector((0, 0, z_top)),
                c + d * r_out + t * s + Vector((0, 0, B))]
    hull(part, pts, mat, 0.04)


# Layered wall paneling on the faces the RTS camera sees (mirrored for symmetry)
mirrored(plate_grid, core, (4.7, -4.4, 3.3), (0, 3.8, 0), (0, 0, 1.2), (1, 0, 0), 3, 1, "panel")
mirrored(plate_grid, core, (4.7, -3.8, B + 0.05), (0, 3.2, 0), (0, 0, 0.95), (1, 0, 0), 3, 1, "panel")
mirrored(plate_grid, core, (4.3, 0.2, 3.15), (0, 2.6, 0), (0, 0, 1.1), (1, 0, 0), 2, 1, "panel")
mirrored(plate_grid, core, (2.5, -3.9, 5.1), (1.7, 0, 0), (0, 3.1, 0), (0, 0, 1), 1, 3, "panel")
mirrored(plate_grid, core, (3.0, -1.8, 5.2), (0, 2.3, 0), (0, 0, 1.6), (1, 0, 0), 2, 1, "panel")
plate_grid(core, (-2.7, -1.9, 6.45), (5.4, 0, 0), (0, 0, 0.45), (0, -1, 0), 4, 1, "panel")
plate_grid(u, (-10.8, -1.1, 2.95), (4.3, 0, 0), (0, 0, 0.6), (0, -1, 0), 4, 1, "mid")
# Inset access panels
framed(u, (-6.5, -0.9, B + 0.05), (0, 1.1, 0), (0, 0, 2.3), (1, 0, 0), "yellow", "mid")
box(u, (-6.5, -0.6, 2.8), (-6.42, -0.1, 2.92), "glow", 0)
mirrored(framed, core, (4.7, -1.3, B + 1.45), (0, 0.6, 0), (0, 0, 1.3), (1, 0, 0), "dark", "mid")

# Intake: overhang canopy with floodlights, hydraulic rams, segmented bay door
box(core, (-DOOR - 0.6, -5.0, 4.6), (DOOR + 0.6, -4.3, 5.05), "dark", 0.06)
for x in (-1.6, 1.6):
    box(core, (x - 0.5, -4.95, 4.45), (x + 0.5, -4.55, 4.6), "mid", 0.03)
    box(core, (x - 0.4, -4.9, 4.42), (x + 0.4, -4.6, 4.46), "glow", 0)
for s in (-1, 1):
    hull(core, [(s * x, y, z) for x in (DOOR + 0.3, DOOR + 0.55)
                for y, z in ((-4.4, 3.9), (-4.4, 4.6), (-4.95, 4.6))], "dark", 0.02)
box(core, (-DOOR, -5.6, B), (DOOR, -2.4, B + 0.1), "deck", 0.02)            # bay floor plate up to the ramp
for y in (-4.0, -3.0):                                                     # bay ceiling lights
    box(core, (-1.8, y, 3.34), (1.8, y + 0.2, 3.4), "glow", 0)
for z in (1.15, 1.6, 2.05, 2.5, 2.95):
    box(core, (-1.9, -2.57, z), (1.9, -2.5, z + 0.08), "mid", 0)
ram = Vector((0, 2.7, 2.0)).normalized()
for s in (-1, 1):
    start = Vector((s * 4.8, -7.9, 0.45))
    cyl("ramp", start, 0.2, 1.9, "mid", seg=20, bevel=0.03, direction=ram)
    cyl("ramp", start + ram * 1.9, 0.09, 1.45, "chrome", seg=16, bevel=0.01, direction=ram)
    for mount in (start, start + ram * 3.35):
        box("ramp", mount - Vector((0.25, 0.25, 0.25)), mount + Vector((0.25, 0.25, 0.25)),
            "dark", 0.04)
    box("ramp", (s * 4.6 - 0.1, -8.35, 0), (s * 4.6 + 0.1, -7.6, 0.6), "dark", 0.03)

# Core drum: gussets on the visible back quarter, top-ring access hatch
for ang in (40, 65, 115, 140):
    brace(core, 0, CORE_Y, ang, CORE_R - 0.1, CORE_R + 0.8, 0.4, 3.0, "dark")
box(core, (0.7, 1.9, 7.45), (1.5, 2.7, 7.7), "mid", 0.05)

# Pipe support frame under the spine
for x in (-0.75, 0.45):
    box(p, (x, 6.45, B), (x + 0.3, 6.75, 4.0), "dark", 0.03)
box(p, (-0.85, 6.4, 3.85), (0.85, 6.8, 4.0), "dark", 0.03)


# Tanks: ring girder on columns, weld courses, lid ribs, manway, vent, ladder
def tank_real(part, x, y=TANK_Y, r=TANK_R):
    c = Vector((x, y, 0))
    d = lambda a: Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
    for z in (2.95, 4.45):
        cyl(part, (x, y, z), r + 0.025, 0.07, "dark", seg=64, bevel=0)
    cyl(part, (x, y, 1.95), r + 0.55, 0.3, "dark", seg=64, bevel=0.04)
    for k in range(8):
        rib(part, x, y, 22.5 + 45 * k, r + 0.15, r + 0.5, 0.32, B, 1.95, "mid", bevel=0.03)
    for k in range(8):
        dv, tv = d(22.5 + 45 * k), d(112.5 + 45 * k)
        pts = []
        for w in (-0.1, 0.1):
            for rr, zz in ((1.45, 6.2), (r + 0.02, 5.7)):
                pts += [c + dv * rr + tv * w + Vector((0, 0, zz)),
                        c + dv * rr + tv * w + Vector((0, 0, zz + 0.14))]
        hull(part, pts, "dark", 0.02)
    cyl(part, (x, y, 6.42), 0.7, 0.18, "mid", seg=32)
    box(part, (x + 0.55, y - 0.25, 6.3), (x + 0.95, y + 0.25, 6.6), "dark", 0.04)
    pipe(part, [(x - 1.0, y + 0.5, 6.2), (x - 1.0, y + 0.5, 7.0), (x - 0.45, y + 0.5, 7.0),
                (x - 0.45, y + 0.5, 6.75)], 0.12, mat="mid")
    dv, tv = d(255), d(345)
    for w in (-0.3, 0.3):
        p0 = c + dv * (r + 0.25) + tv * w
        hull(part, [p0 + dv * a + tv * b + Vector((0, 0, z)) for a in (-0.04, 0.04)
                    for b in (-0.04, 0.04) for z in (2.25, 6.0)], "yellow", 0)
    for i in range(10):
        z = 2.5 + i * 0.35
        hull(part, [c + dv * (r + 0.25 + a) + tv * b + Vector((0, 0, z + h)) for a in (-0.03, 0.03)
                    for b in (-0.3, 0.3) for h in (0, 0.05)], "mid", 0)
    for z in (2.6, 5.0):
        hull(part, [c + dv * rr + tv * b + Vector((0, 0, z + h)) for rr in (r - 0.05, r + 0.25)
                    for b in (-0.3, 0.3) for h in (0, 0.08)], "dark", 0)


tank_real("tank_left", -TANK_X)
tank_real("tank_right", TANK_X)


# Props: barrels and crates that sell the scale
def barrel(x, y, mat):
    cyl("props", (x, y, B), 0.3, 0.9, mat, seg=24, bevel=0.03)
    for z in (B + 0.3, B + 0.6):
        cyl("props", (x, y, z), 0.315, 0.05, mat, seg=24, bevel=0)
    cyl("props", (x, y, B + 0.9), 0.26, 0.03, "mid", seg=24, bevel=0)


def crate(lo, hi):
    box("props", lo, hi, "crate", 0.04)
    lo, hi = Vector(lo), Vector(hi)
    for dz in (0.08, hi.z - lo.z - 0.16):
        box("props", (lo.x - 0.03, lo.y - 0.03, lo.z + dz), (hi.x + 0.03, hi.y + 0.03, lo.z + dz + 0.08),
            "dark", 0.01)


barrel(5.0, -2.1, "barrel")
barrel(5.0, -2.8, "barrel")
barrel(5.6, -3.5, "mid")
crate((5.35, -2.6, B), (6.0, -1.9, B + 0.9))
barrel(-5.0, -2.3, "barrel")
crate((-5.95, -3.4, B), (-5.25, -2.6, B + 0.8))
crate((-5.85, -3.3, B + 0.8), (-5.35, -2.75, B + 1.3))

# --- Join parts, shade, group under one empty ---------------------------------

root = bpy.data.objects.new("FluxRefinery", None)
col.objects.link(root)
building = [root]
total_tris = 0
for name, objs in PARTS.items():
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs,
                                   selected_objects=objs):
        bpy.ops.object.join()
    obj = objs[0]
    obj.name = name
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=math.radians(35))
    obj.parent = root
    building.append(obj)
    tris = sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
    total_tris += tris
    print(f"{name:16s} {tris:6d} tris")
print(f"{'TOTAL':16s} {total_tris:6d} tris")
bpy.data.orphans_purge(do_recursive=True)
for obj in building[1:]:
    obj.data.name = obj.name

# --- Export GLB (building only) -----------------------------------------------

for obj in building:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, "refinery.glb"),
                          export_format="GLB", use_selection=True)
for obj in building:
    obj.select_set(False)


# --- Stage: terrain, sun, sky, Cycles -------------------------------------------

bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
ground = bpy.context.active_object
ground.name = "Ground"
ground.data.materials.append(material("Terrain", (0.21, 0.18, 0.14), 0.95, wear=0.0))

bpy.ops.object.light_add(type="SUN", location=(-10, -15, 20))
sun = bpy.context.active_object
sun.data.energy = 4.5
sun.data.color = (1.0, 0.95, 0.87)
sun.data.angle = math.radians(1.5)
sun.rotation_euler = (-Vector((-0.5, -0.9, 1.4))).to_track_quat("-Z", "Y").to_euler()

# Work light inside the loading bay so the recess under the overhang isn't a black hole
bay_light = bpy.data.lights.new("BayLight", "AREA")
bay_light.energy = 400
bay_light.shape = "RECTANGLE"
bay_light.size, bay_light.size_y = 4.0, 2.4
bay_light.color = (0.85, 0.92, 1.0)
bay_obj = bpy.data.objects.new("BayLight", bay_light)
col.objects.link(bay_obj)
bay_obj.location = (0, -3.6, 3.3)
bay_obj.visible_camera = False  # its unlit back face would show through the doorway
bay_obj.visible_glossy = False

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.65, 0.8, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
scene.world = world

scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = dev.type == "METAL"  # GPU only; hybrid CPU+GPU is slower here
    scene.cycles.device = "GPU"
except Exception as exc:  # fall back to CPU
    print("GPU unavailable, rendering on CPU:", exc)
scene.cycles.samples = 128
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass
scene.render.image_settings.file_format = "PNG"


def render(name, location, rotation, ortho, res, border=None):
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho
    cam_data.clip_end = 500
    cam = bpy.data.objects.new(name, cam_data)
    col.objects.link(cam)
    cam.location = location
    cam.rotation_euler = rotation
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.use_border = scene.render.use_crop_to_border = border is not None
    if border:
        (scene.render.border_min_x, scene.render.border_max_x,
         scene.render.border_min_y, scene.render.border_max_y) = border
    scene.render.filepath = os.path.join(OUT_DIR, f"refinery_{name}.png")
    bpy.ops.render.render(write_still=True)


# RTS camera: orthographic, 45 deg yaw, 30 deg down (classic 2:1 isometric game view)
RTS_ROT = (math.radians(60), 0, math.radians(45))
rts_dir = Vector((0, 0, 1))
rts_dir.rotate(Matrix.Rotation(RTS_ROT[0], 3, "X"))
rts_dir.rotate(Matrix.Rotation(RTS_ROT[2], 3, "Z"))
target = Vector((-1.5, 1.6, 2.5))
# 1. Main isometric view (gameplay angle, presentation size)
render("iso", target + rts_dir * 80, RTS_ROT, 27, (1800, 1350))
# 1b. Same view at true gameplay pixel scale (1080p screen showing ~80 m), cropped to the building
render("gameplay", target + rts_dir * 80, RTS_ROT, 80, (1920, 1080), border=(0.36, 0.70, 0.30, 0.70))
# 2. Front view
render("front", (-1.5, -60, 4.8), (math.radians(90), 0, 0), 23, (1600, 1000))
# 3. Top-down view
render("top", (-1.5, 0.0, 60), (0, 0, 0), 21, (1400, 1300))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "refinery.blend"))
