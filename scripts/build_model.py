"""
build_model.py — the HyprDesk hero rig, generated from scratch, headless.

    & "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" -b --factory-startup -P scripts\\build_model.py

Optional, for review only (never committed):
    ... -P scripts\\build_model.py -- --blend OUT.blend --preview DIR

Writes public/models/hyprdesk.glb (Draco). Deterministic: same Blender, same bytes.

WHAT IT BUILDS (see CONTRACT.md §6 — mesh + material names are frozen)

    Router        RouterCore    faceted gem, emissive — the core
    RouterCage    Cage          geodesic strut cage around it — metal
    EngineClaude  ShellClaude   tall pointed spindle
    EngineCodex   ShellCodex    chamfered block
    EngineOpenCode ShellOpenCode thin open ring
    Glyph*        Glyph         the engine marks — real extruded geometry, shared emissive mat

The three engines are three different SOLIDS, not one mesh in three colours: spindle,
block, ring. Strip the colour and the silhouette still tells you which is which.

UNITS: Blender units == scene units (scene.js renormalizes the rig anyway), NOT millimetres.
       Nothing here is a manufactured part, so a mm scale would be a fiction.
AXES:  Blender is Z-up; the exporter's export_yup rotates to glTF's +Y-up. Engines are
       authored at Blender (R·cos a, -R·sin a, 0) precisely so they land at glTF
       (R·cos a, 0, R·sin a) — the ring in the XZ plane, starting at +X, that scene.js
       assumes (glTF z = -blender y).
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Matrix, Euler, Vector

# ─── the whole shape of the thing, in one block ──────────────────────────────
RING_R      = 2.6          # engine orbit radius (CONTRACT)
ENGINE_TILT = math.radians(12)   # pitch the mark-bearing face up, so it catches the key

CORE_R      = 0.50
CAGE_R      = 1.00
CAGE_STRUT  = 0.060

HEX = 6

COL = {                    # sRGB, as designers hand them over
    "core":   0x141821,
    "coreEm": 0xFFD8AC,
    "cage":   0x9AA1AC,
    "claude": 0xD97757,    # ─┐
    "codex":  0x10A37F,    #  ├─ CONTRACT §3 ENGINES[].hex
    "open":   0x7C5CFF,    # ─┘
    "glyph":  0x0B0D10,
    "glyphEm": 0xFFFFFF,
}
ROUGH = {"claude": 0.34, "codex": 0.30, "open": 0.38}   # CONTRACT §3 ENGINES[].rough

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GLB  = os.path.join(ROOT, "public", "models", "hyprdesk.glb")


# ─── bmesh helpers (world-unit, Z-up local frames) ───────────────────────────
def finish(bm, name):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def icosphere(bm, subdiv, radius):
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    except TypeError:                      # <4.0 called it `diameter`
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, diameter=radius)


def box(bm, size, loc=(0, 0, 0), rot=(0, 0, 0)):
    m = (Matrix.Translation(loc)
         @ Euler(rot, 'XYZ').to_matrix().to_4x4()
         @ Matrix.Diagonal(Vector((*size, 1.0))))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def lathe(bm, profile, seg, phase):
    """Revolve (r, z) around Z. phase=pi/seg puts a FACET (not a vertex) on +X."""
    rings = []
    for i in range(seg):
        a = phase + 2 * math.pi * i / seg
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * ca, r * sa, z)) for r, z in profile])
    for i in range(seg):
        j = (i + 1) % seg
        for k in range(len(profile) - 1):
            a0, a1, b0, b1 = rings[i][k], rings[i][k + 1], rings[j][k], rings[j][k + 1]
            if (a0.co - b0.co).length < 1e-9:        # apex vertex is shared -> triangle
                bm.faces.new((a0, a1, b1))
            elif (a1.co - b1.co).length < 1e-9:
                bm.faces.new((a0, a1, b0))
            else:
                bm.faces.new((a0, a1, b1, b0))


def torus_x(bm, R, r, nmaj, nmin):
    """Faceted torus whose HOLE looks down +X — so it reads as a ring, not a disc."""
    grid = []
    for i in range(nmaj):
        u = 2 * math.pi * (i + 0.5) / nmaj
        cu, su = math.cos(u), math.sin(u)
        row = []
        for j in range(nmin):
            v = 2 * math.pi * (j + 0.5) / nmin
            rr = R + r * math.cos(v)
            row.append(bm.verts.new((r * math.sin(v), rr * cu, rr * su)))
        grid.append(row)
    for i in range(nmaj):
        i2 = (i + 1) % nmaj
        for j in range(nmin):
            j2 = (j + 1) % nmin
            bm.faces.new((grid[i][j], grid[i][j2], grid[i2][j2], grid[i2][j]))


def prism_x(bm, pts, x0, x1):
    """Extrude a closed YZ polygon along X. Concave polys are fine (star points)."""
    a = [bm.verts.new((x0, y, z)) for y, z in pts]
    b = [bm.verts.new((x1, y, z)) for y, z in pts]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))


# ─── modifiers / shading / materials ─────────────────────────────────────────
def _activate(ob):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def _deactivate(ob):
    ob.select_set(False)


def wireframe(ob, thickness):
    m = ob.modifiers.new("wf", 'WIREFRAME')
    m.thickness = thickness
    m.use_even_offset = True
    m.use_relative_offset = False
    m.use_replace = True
    m.use_boundary = True
    m.use_crease = False
    _activate(ob)
    bpy.ops.object.modifier_apply(modifier=m.name)
    _deactivate(ob)


def bevel(ob, width, segments, angle_deg=25.0):
    m = ob.modifiers.new("bv", 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle_deg)
    m.miter_outer = 'MITER_ARC'
    m.use_clamp_overlap = True          # star points would self-intersect without it
    _activate(ob)
    bpy.ops.object.modifier_apply(modifier=m.name)
    _deactivate(ob)


def shade(ob, angle_deg):
    """
    Smooth across the bevel rounds, hard across the facets. (`use_auto_smooth` is gone;
    this operator is the 4.1+ replacement.)

    The angle has to sit BETWEEN the two: above the bevel's per-segment step (so the edge
    rounds and catches a highlight) and below the facet-to-facet dihedral (so the facets
    stay crisp). Get it wrong on the high side and the whole model melts — a 30° angle on
    a geodesic core whose facets only turn ~22° smooths the facets away and you get a
    blob in a cage. Hence a different angle per piece; they have different dihedrals.
    """
    _activate(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    _deactivate(ob)


def srgb(h):
    c = [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def pbr(name, base, rough, metal, coat=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(base), 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.12
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1.0)
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


def paint(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ─── the pieces ──────────────────────────────────────────────────────────────
def build_router():
    bm = bmesh.new()
    icosphere(bm, 1, CORE_R)
    ob = finish(bm, "Router")
    ob.data.transform(Matrix.Diagonal(Vector((1.0, 1.0, 1.16, 1.0))))   # a gem, not a ball
    bevel(ob, 0.018, 3)
    shade(ob, 12.0)               # geodesic facets only turn ~22° — smooth above that and it's a blob
    return ob


def build_cage():
    bm = bmesh.new()
    icosphere(bm, 1, CAGE_R)
    ob = finish(bm, "RouterCage")
    wireframe(ob, CAGE_STRUT)     # 80 tri faces -> a geodesic lattice of struts
    bevel(ob, 0.009, 2, angle_deg=35.0)
    shade(ob, 20.0)
    return ob


def build_claude():
    """Spindle: hexagonal, pointed both ends, taller than it is wide. A shard."""
    bm = bmesh.new()
    lathe(bm, [(0.00, -0.71), (0.34, -0.30), (0.50, 0.00), (0.39, 0.30), (0.00, 0.75)],
          HEX, math.pi / HEX)
    ob = finish(bm, "EngineClaude")
    bevel(ob, 0.020, 3)           # 60° facet edges, split into 15° steps
    shade(ob, 22.0)               # ...rounds the edge, leaves the six facets dead flat
    return ob


def build_codex():
    """Block: a chamfered cube. Machined, precise, unmistakably not a gem."""
    bm = bmesh.new()
    box(bm, (0.96, 0.96, 0.96))
    ob = finish(bm, "EngineCodex")
    bevel(ob, 0.085, 3)           # 9% of the edge: a machined chamfer, not a soft app icon
    shade(ob, 26.0)
    return ob


def build_opencode():
    """Ring: thin, open, hole facing out. Even edge-on it's a bar, never a block."""
    bm = bmesh.new()
    torus_x(bm, 0.50, 0.15, 10, 6)
    ob = finish(bm, "EngineOpenCode")
    bevel(ob, 0.020, 2)
    shade(ob, 20.0)               # 36° around the ring, 60° across it — both stay faceted
    return ob


def star_pts(rays, r_out, r_in, sharp=0.42):
    """A tapered burst — sharp rays, not a fat cog. `sharp` narrows the ray root."""
    pts = []
    for i in range(rays):
        a = 2 * math.pi * i / rays
        h = math.pi / rays
        pts.append((r_out * math.cos(a), r_out * math.sin(a)))
        pts.append((r_in * math.cos(a + h * sharp), r_in * math.sin(a + h * sharp)))
        pts.append((r_in * math.cos(a + h * (2 - sharp)), r_in * math.sin(a + h * (2 - sharp))))
    return pts


# Every mark is authored on its engine's local +X face, which is the face that points away
# from the router. Looking straight at that face (camera on +X, world up), SCREEN-RIGHT IS
# +Y and screen-up is +Z. Get that backwards and the Codex prompt renders as `<_`.

def build_glyph_claude():
    """The burst. Its base is sunk inside the spindle's +X facet (x≈0.38), tips stand proud —
    so there is no coplanar pair anywhere, and therefore nothing to z-fight."""
    bm = bmesh.new()
    prism_x(bm, star_pts(8, 0.185, 0.062, sharp=0.38), 0.34, 0.490)
    ob = finish(bm, "GlyphClaude")
    bevel(ob, 0.006, 1, angle_deg=30.0)
    shade(ob, 20.0)
    return ob


def build_glyph_codex():
    """`>_` — the prompt. Two bars and a rule, on the block's +X face (x=0.48)."""
    bm = bmesh.new()
    arm, th, dep = 0.23, 0.060, 0.13
    for s in (+1, -1):                       # apex at +Y == screen-right: this reads `>`
        box(bm, (dep, arm, th), loc=(0.455, 0.060, s * 0.082),
            rot=(-s * math.radians(42), 0, 0))
    box(bm, (dep, 0.30, 0.055), loc=(0.455, -0.020, -0.210))
    ob = finish(bm, "GlyphCodex")
    bevel(ob, 0.010, 1)
    shade(ob, 20.0)
    return ob


def build_glyph_opencode():
    """
    A triangle of struts with a node at each corner, bridging the ring's aperture. It's a
    three-node graph — the A2A mesh, and the three providers. The mark lives INSIDE the
    hole rather than on a face, because on this engine the hole IS the face.

    An earlier version was a hub with three radiating spokes. Rendered, it read as a
    download arrow. A closed triangle can't be mistaken for one.
    """
    bm = bmesh.new()
    R, th, dep = 0.26, 0.048, 0.10
    corner = [(R * math.cos(2 * math.pi * i / 3 + math.pi / 2),
               R * math.sin(2 * math.pi * i / 3 + math.pi / 2)) for i in range(3)]
    for i in range(3):
        (y0, z0), (y1, z1) = corner[i], corner[(i + 1) % 3]
        box(bm, (dep, math.hypot(y1 - y0, z1 - z0), th),
            loc=(0.0, (y0 + y1) / 2, (z0 + z1) / 2),
            rot=(math.atan2(z1 - z0, y1 - y0), 0, 0))
        box(bm, (dep + 0.02, 0.10, 0.10), loc=(0.0, y0, z0),
            rot=(math.radians(45), 0, 0))          # the nodes
    ob = finish(bm, "GlyphOpenCode")
    bevel(ob, 0.010, 1)
    shade(ob, 20.0)
    return ob


# ─── assembly ────────────────────────────────────────────────────────────────
def place(engine, glyph, slot):
    """
    Seat an engine on the ring and bake its orientation INTO THE MESH.

    Both meshes are authored in the engine's local frame (mark on local +X), then the
    same matrix is baked into both — so the pair can never come apart, and the object
    keeps rotation=0 / scale=1 as the contract demands. The glyph is PARENTED to the
    engine with a zero local transform: the offset lives in mesh data, so moving the
    engine (the orbit) carries the mark with it, and the pivot stays at the engine centre.
    """
    a = 2 * math.pi * slot / 3
    # glTF z = -blender y, so -sin here == +sin there: the ring lands in XZ, starting at +X.
    pos = Vector((RING_R * math.cos(a), -RING_R * math.sin(a), 0.0))
    R = Matrix.Rotation(-a, 4, 'Z') @ Matrix.Rotation(-ENGINE_TILT, 4, 'Y')
    engine.data.transform(R)
    glyph.data.transform(R)
    engine.location = pos
    glyph.parent = engine
    glyph.matrix_parent_inverse = Matrix.Identity(4)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)   # no default cube / lamp / camera

    mats = {
        "RouterCore":    pbr("RouterCore", COL["core"], 0.22, 0.0,
                             emit=COL["coreEm"], emit_strength=3.0),
        "Cage":          pbr("Cage", COL["cage"], 0.26, 1.0),
        "ShellClaude":   pbr("ShellClaude", COL["claude"], ROUGH["claude"], 0.10, coat=0.15),
        "ShellCodex":    pbr("ShellCodex", COL["codex"], ROUGH["codex"], 0.10, coat=0.15),
        "ShellOpenCode": pbr("ShellOpenCode", COL["open"], ROUGH["open"], 0.10, coat=0.15),
        "Glyph":         pbr("Glyph", COL["glyph"], 0.30, 0.0,
                             emit=COL["glyphEm"], emit_strength=2.0),
    }

    paint(build_router(), mats["RouterCore"])
    paint(build_cage(), mats["Cage"])

    engines = [
        (build_claude(),   build_glyph_claude(),   "ShellClaude"),
        (build_codex(),    build_glyph_codex(),    "ShellCodex"),
        (build_opencode(), build_glyph_opencode(), "ShellOpenCode"),
    ]
    for slot, (eng, gly, shell) in enumerate(engines):
        paint(eng, mats[shell])
        paint(gly, mats["Glyph"])       # ONE shared Glyph material — deliberate (CONTRACT §6)
        place(eng, gly, slot)

    # Rotation and scale are already baked into the mesh data; this is the belt-and-braces
    # pass that guarantees scale == (1,1,1) on every node, which the contract asks for.
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    tris = 0
    for o in bpy.context.scene.objects:
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        tris += n
        print(f"###   {o.name:<16} {n:>6,} tris   scale={tuple(round(v, 4) for v in o.scale)}")

    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--blend" in argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[argv.index("--blend") + 1]))

    os.makedirs(os.path.dirname(GLB), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,      # there are no UVs and there never will be
        export_materials='EXPORT',
        export_extras=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_generic_quantization=12,
    )
    kb = os.path.getsize(GLB) / 1024
    print(f"### TRIS {tris:,}")
    print(f"### GLB  {GLB}  {kb:.1f} KB")


main()
