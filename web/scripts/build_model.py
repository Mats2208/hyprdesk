"""
build_model.py — the HyprDesk hero rig, generated from scratch, headless.

    & "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" -b --factory-startup -P scripts\\build_model.py

Optional, for review only (never committed):
    ... -P scripts\\build_model.py -- --blend OUT.blend

Writes public/models/hyprdesk.glb (Draco). Deterministic: same Blender, same bytes.

WHAT IT BUILDS (see CONTRACT.md §6 — mesh + material names are frozen)

    Router         RouterCore     faceted crystal, emissive — the core
    RouterCage     Cage           gimbal rings + geodesic lattice — metal
    EngineClaude   ShellClaude    Claude — a 6-petal blossom (flower)
    EngineCodex    ShellCodex     Codex — a plump cushion + the >_ prompt
    EngineOpenCode ShellOpenCode  OpenCode — the pixel 'glass' icon as voxels
    Glyph*         Glyph          the engine marks — real geometry, shared emissive mat

THE ONE RULE OF THIS FILE: the three engines must be tellable apart IN A BLUR.
Not by colour — by MASS. So they differ in the axis the orbit cannot rotate away:
scene.js spins each engine about the vertical (`rig.rotation.y = phase`), which means
**HEIGHT IS INVARIANT** under the whole story. Height is therefore where the identity
lives:

    Claude   2.80 tall · 1.10 wide   ratio 2.5:1 standing   — mass, gravity
    Codex    0.70 tall · 1.66 wide   ratio 2.4:1 lying      — instrument, precision
    OpenCode 1.80 tall · 0.62 deep   50% air                — open

Tall / low / hollow. At 200 px, in greyscale, out of focus, that still resolves.
The glyphs are an INLAY (recessed pad, mark sunk into it) — they accent the identity;
they no longer have to carry it.

DENSITY: scene.js normalizes the whole rig to a fixed 3 units, so the bounding box is a
CONSTANT and the only way to make the object read bigger is to grow the parts RELATIVE to
the ring (which the contract pins at 2.6). That is nearly free, because a fatter engine
grows the numerator (its own size) far faster than the denominator (a box already 5+ units
wide because of the ring). The core/cage is free outright: it lives inside the ring and
does not touch the box at all. `### FRAME` at the bottom prints exactly what scene.js will
compute, so the claim is checkable.

UNITS: Blender units == scene units (scene.js renormalizes the rig anyway), NOT millimetres.
       Nothing here is a manufactured part, so a mm scale would be a fiction.
AXES:  Blender is Z-up; the exporter's export_yup rotates to glTF's +Y-up. Engines are
       authored at Blender (R·cos a, -R·sin a, 0) precisely so they land at glTF
       (R·cos a, 0, R·sin a) — the ring in the XZ plane, starting at +X, that scene.js
       assumes (glTF z = -blender y).
LOCAL FRAME of an engine: +X points AWAY from the router (that is the mark-bearing face),
       +Y is tangential, +Z is up. Looking at the mark, screen-right is +Y, screen-up +Z.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Matrix, Euler, Vector

# ─── the whole shape of the thing, in one block ──────────────────────────────
RING_R = 2.6                      # engine orbit radius (CONTRACT §6)

# Per-engine pitch about local Y. It is not just "lift the mark to the key light" any more —
# it is ATTITUDE, and each engine gets its own. The blade leans in toward the core (a heavy
# thing tipping under gravity); the instrument sits nearly dead level (precision); the frame
# leans back like a portal you walk through.
TILT = (math.radians(10), math.radians(3), math.radians(15))

CORE_R = 0.62                     # girdle. Was 0.50 — but see CORE_H: it grew UPWARD.
CORE_H = 2.05                     # 3.3:1 tall. An emissive object has no shading, so the
#                                   core can only read by SILHOUETTE, and a fat 12-fold gem
#                                   in profile IS a circle. See build_router().
CAGE_R = 1.42                     # was 1.00
CAGE_STRUT = 0.052
GIMBAL_R = 0.070

COL = {                    # sRGB, as designers hand them over
    "core":   0x141821,
    "coreEm": 0xFFD8AC,
    "cage":   0x9AA1AC,
    "claude": 0xD97757,    # ─┐
    "codex":  0x6366F1,    #  ├─ CONTRACT §3 ENGINES[].hex  (blue-violet — Codex is the cushion)
    "open":   0x7C5CFF,    # ─┘
    "glyph":  0x0B0D10,
    "glyphEm": 0xFFFFFF,
}
ROUGH = {"claude": 0.34, "codex": 0.30, "open": 0.38}   # CONTRACT §3 ENGINES[].rough

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GLB = os.path.join(ROOT, "public", "models", "hyprdesk.glb")


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


def chamfered_rect(hx, hy, c, dx=0.0, dy=0.0):
    """A rectangle with its four corners cut: keeps a BROAD FLAT ±X face (the mark lives
    there) while the cut corners give the vertical facets that catch the key light. An
    n-gon would not: its +X 'face' is only sin(π/n) of the depth, too narrow for a mark."""
    c = min(c, hx * 0.9, hy * 0.9)
    return [(dx + x, dy + y) for x, y in
            [(hx, hy - c), (hx - c, hy), (-(hx - c), hy), (-hx, hy - c),
             (-hx, -(hy - c)), (-(hx - c), -hy), (hx - c, -hy), (hx, -(hy - c))]]


def loft(bm, sections):
    """
    sections = [(z, [(x, y), ...]), ...] bottom→top, equal vert counts, closed rings.
    Caps both ends. Repeat a z with a different ring to get a hard horizontal STEP —
    that is how the plinth under the blade and the stepped rails of the module are made,
    and it is why neither engine needs a boolean union: one skin, no interior faces.
    (Interior faces are not cosmetic here — `S.xray` ghosts the shells, so anything buried
    inside a shell becomes visible clutter in the tunnel act.)
    """
    rings = [[bm.verts.new((x, y, z)) for x, y in pts] for z, pts in sections]
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            if (a[i].co - b[i].co).length < 1e-9 and (a[j].co - b[j].co).length < 1e-9:
                continue                                  # degenerate band (a pure step of 0)
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])


def annulus_x(bm, n, r_out, r_in, x0, x1, phase=0.0):
    """A flat faceted washer with a bore, extruded along X. The bore is the point:
    OpenCode's negative space has to be real geometry you can see through, not a dark
    material."""
    def ring(r, x):
        return [bm.verts.new((x, r * math.cos(phase + 2 * math.pi * i / n),
                              r * math.sin(phase + 2 * math.pi * i / n))) for i in range(n)]
    oa, ob_, ia, ib = ring(r_out, x0), ring(r_out, x1), ring(r_in, x0), ring(r_in, x1)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((oa[i], oa[j], ob_[j], ob_[i]))      # outer wall
        bm.faces.new((ib[i], ib[j], ia[j], ia[i]))        # bore
        bm.faces.new((ia[i], ia[j], oa[j], oa[i]))        # back face
        bm.faces.new((ob_[i], ob_[j], ib[j], ib[i]))      # front face


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


def _apply(ob, m):
    _activate(ob)
    bpy.ops.object.modifier_apply(modifier=m.name)
    _deactivate(ob)


def wireframe(ob, thickness):
    m = ob.modifiers.new("wf", 'WIREFRAME')
    m.thickness = thickness
    m.use_even_offset = True
    m.use_relative_offset = False
    m.use_replace = True
    m.use_boundary = True
    m.use_crease = False
    _apply(ob, m)


def boolean(ob, cutter, op):
    m = ob.modifiers.new("bool", 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.object = cutter
    _apply(ob, m)
    bpy.data.objects.remove(cutter, do_unlink=True)


def bevel(ob, width, segments, angle_deg=25.0):
    m = ob.modifiers.new("bv", 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle_deg)
    m.miter_outer = 'MITER_ARC'
    m.use_clamp_overlap = True          # star points would self-intersect without it
    _apply(ob, m)


def shade(ob, angle_deg):
    """
    Smooth across the bevel rounds, hard across the facets. (`use_auto_smooth` is gone;
    this operator is the 4.1+ replacement.)

    The angle has to sit BETWEEN the two: above the bevel's per-segment step (90°/(seg+1),
    so the edge rounds and catches a highlight) and below the facet-to-facet dihedral (so
    the facets stay crisp). Get it wrong on the high side and the model melts — 30° on a
    geodesic core whose facets only turn ~22° smooths the facets away and you get a blob in
    a cage. Hence a different angle per piece; they have different dihedrals.
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


# ─── the router: the centre of gravity of the whole composition ──────────────
def build_router():
    """
    A tall bipyramid crystal, standing on the vertical axis of the whole composition.

    Two things drove this, and both were learned by rendering it wrong first.

    · **The core is EMISSIVE, and emission is view-independent — it produces no shading.**
      So the core cannot be read by its facets the way the shells can; whatever is glowing
      hardest reads as a flat patch of light, and all that survives is the OUTLINE. The
      first cut was a fat 12-fold gem: correct in Blender, and on the page a luminous
      circle. A ball. The exact note the client opened with.
      Hence: 8-fold (not 12), and 3.3:1 TALL (not 1.9:1 round). In profile that is a
      pointed crystal at any angle — angular and vertical against a cage that is round.

    · It is also NARROWER than the first cut (girdle 0.80 → 0.62). A core that fills its
      cage hides the cage. The volume went up the axis instead, where it buys silhouette.
    """
    bm = bmesh.new()
    R, H = CORE_R, CORE_H
    lathe(bm, [
        (0.00, -H * 0.50),      # culet
        (R * 0.30, -H * 0.38),
        (R * 0.92, -H * 0.10),
        (R * 1.00, 0.00),       # girdle — the widest line, and a hard one
        (R * 0.92, H * 0.10),
        (R * 0.30, H * 0.38),
        (0.00, H * 0.50),       # table
    ], 8, math.pi / 8)
    ob = finish(bm, "Router")
    bevel(ob, 0.018, 1)
    shade(ob, 8.0)              # hard. A gem that smooths is a ball with a highlight on it.
    return ob


def build_cage():
    """
    A gyroscope, not a golf ball: two chunky gimbal rings (one equatorial, one polar) that
    the A2A wires visibly plug into, wrapped in a fine geodesic lattice. scene.js anchors
    the links to the cage's XZ radius and sizes the halo from its sphere radius, so the
    equatorial ring is doing real work, not decoration.
    """
    lat = bmesh.new()
    icosphere(lat, 1, CAGE_R)
    ob = finish(lat, "RouterCage")
    wireframe(ob, CAGE_STRUT)          # 80 tri faces -> a geodesic lattice of struts

    rings = bmesh.new()
    for R, tilt in ((CAGE_R * 1.03, 0.0), (CAGE_R * 0.93, math.pi / 2)):
        n_maj, n_min = 22, 5
        grid = []
        for i in range(n_maj):
            u = 2 * math.pi * (i + 0.5) / n_maj
            row = []
            for j in range(n_min):
                v = 2 * math.pi * (j + 0.5) / n_min
                rr = R + GIMBAL_R * math.cos(v)
                p = Vector((rr * math.cos(u), rr * math.sin(u), GIMBAL_R * math.sin(v)))
                row.append(rings.verts.new(Matrix.Rotation(tilt, 3, 'X') @ p))
            grid.append(row)
        for i in range(n_maj):
            i2 = (i + 1) % n_maj
            for j in range(n_min):
                j2 = (j + 1) % n_min
                rings.faces.new((grid[i][j], grid[i][j2], grid[i2][j2], grid[i2][j]))
    gim = finish(rings, "gimbals")

    boolean(ob, gim, 'UNION')          # one skin: the Cage is ghosted by S.xray too
    bevel(ob, 0.008, 2, angle_deg=35.0)
    shade(ob, 22.0)
    return ob


# ─── the three engines: 3D product logos ─────────────────────────────────────
# Each engine IS its product's logo, given real MASS so it still reads while the rig
# orbits about the vertical: Claude = a 6-petal blossom · Codex = a plump cushion + the >_
# prompt · OpenCode = the pixel 'glass' icon as a voxel block. Authored in the same local
# frame the old forms used — mark on local +X (points away from the router), width +Y,
# height +Z — so place() and the frozen Engine*/Glyph* names still hold.


def build_claude():
    """Claude: a 6-petal BLOSSOM — a flatter, wider medallion. Deep lobes (amplitude 0.32)
    read as distinct petals rather than a puffy blob; the knot rides its centre."""
    N = 96
    pts = [((0.98 * (0.68 + 0.32 * math.cos(6 * a))) * math.cos(a),
            (0.98 * (0.68 + 0.32 * math.cos(6 * a))) * math.sin(a))
           for a in (2 * math.pi * i / N for i in range(N))]
    d = 0.30
    bm = bmesh.new()
    fr = [bm.verts.new((d / 2, y, z)) for (y, z) in pts]
    bk = [bm.verts.new((-d / 2, y, z)) for (y, z) in pts]
    bm.faces.new(fr)
    bm.faces.new(bk[::-1])
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((fr[i], fr[j], bk[j], bk[i]))
    ob = finish(bm, "EngineClaude")
    bevel(ob, 0.09, 3, angle_deg=35)
    shade(ob, 50.0)
    return ob


def build_codex():
    """Codex: a plump CUSHION (rounded blob) carrying the >_ prompt. A 6-lobe silhouette with
    a fat RIM bevel (angle-limited so only the 90° rim rounds, not the gentle lobe seams), so
    the cross-section reads as a pillow, not a coin. The >_ rides its broad flat +X face."""
    N = 72
    pts = [((0.95 * (1 + 0.11 * math.cos(6 * a))) * math.cos(a),
            (0.95 * (1 + 0.11 * math.cos(6 * a))) * math.sin(a))
           for a in (2 * math.pi * i / N for i in range(N))]
    d = 0.44
    bm = bmesh.new()
    fr = [bm.verts.new((d / 2, y, z)) for (y, z) in pts]
    bk = [bm.verts.new((-d / 2, y, z)) for (y, z) in pts]
    bm.faces.new(fr)
    bm.faces.new(bk[::-1])
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((fr[i], fr[j], bk[j], bk[i]))
    ob = finish(bm, "EngineCodex")
    bevel(ob, 0.17, 5, angle_deg=35)   # rim only: the pillow. Lobe seams (<35°) stay
    shade(ob, 60.0)
    return ob


# OpenCode: the pixel 'glass' icon rebuilt as chunky voxels. '#' is the frame (the shell),
# 'o'/'x' are the window fill that becomes the glowing glyph. The blocky mass is what makes
# it survive the orbit edge-on — where the old two-rim frame used a bore, this uses bulk.
OC_GRID = [
    ".#######.",
    "#########",
    "##ooooo##",
    "##ooooo##",
    "##xxxxx##",
    "##xxxxx##",
    "##xxxxx##",
    "##xxxxx##",
    "##xxxxx##",
    "#########",
    ".#######.",
]
OC_PITCH = 0.245


def _oc_cells(kinds):
    """One cube per grid cell whose glyph is in *kinds*. Cells are gapped (0.94 of the
    pitch) so the pixels read AS pixels instead of fusing into a slab."""
    H = len(OC_GRID)
    W = len(OC_GRID[0])
    s = OC_PITCH * 0.94
    D = 0.55
    bm = bmesh.new()
    for r, row in enumerate(OC_GRID):
        for c, ch in enumerate(row):
            if ch in kinds:
                box(bm, (D, s, s),
                    loc=(0.0, (c - (W - 1) / 2) * OC_PITCH, ((H - 1) / 2 - r) * OC_PITCH))
    return bm


def build_opencode():
    """The voxel frame — the dark border of the icon (its shell)."""
    ob = finish(_oc_cells({'#'}), "EngineOpenCode")
    bevel(ob, 0.02, 1, angle_deg=35)
    shade(ob, 20.0)
    return ob


# ─── the marks ───────────────────────────────────────────────────────────────
# Each mark is authored on its engine's local +X face (the face pointing away from the
# router) and rises PROUD of it as its own geometry — still the "engraved glyph" the
# contract asks for (real geometry, the shared emissive Glyph material), just raised rather
# than sunk. Looking at that face (camera on +X, world up), SCREEN-RIGHT IS +Y, screen-up
# is +Z — get it backwards and Claude's prompt renders as `<_`.


def build_glyph_claude():
    """The knot at the blossom's core: a hex ring proud of its +X face (face at x ≈ 0.15)."""
    bm = bmesh.new()

    def hexpts(rr):
        return [(rr * math.cos(math.pi / 6 + math.pi / 3 * k),
                 rr * math.sin(math.pi / 6 + math.pi / 3 * k)) for k in range(6)]

    ro, ri, x0, x1 = 0.36, 0.21, 0.12, 0.21
    O0 = [bm.verts.new((x0, y, z)) for y, z in hexpts(ro)]
    O1 = [bm.verts.new((x1, y, z)) for y, z in hexpts(ro)]
    I0 = [bm.verts.new((x0, y, z)) for y, z in hexpts(ri)]
    I1 = [bm.verts.new((x1, y, z)) for y, z in hexpts(ri)]
    for k in range(6):
        m = (k + 1) % 6
        bm.faces.new((O0[k], O0[m], O1[m], O1[k]))
        bm.faces.new((I1[k], I1[m], I0[m], I0[k]))
        bm.faces.new((I0[k], I0[m], O0[m], O0[k]))
        bm.faces.new((O1[k], O1[m], I1[m], I1[k]))
    ob = finish(bm, "GlyphClaude")
    bevel(ob, 0.008, 1, angle_deg=30.0)
    shade(ob, 25.0)
    return ob


def build_glyph_codex():
    """`>_` — the terminal prompt, proud of the cushion's +X face (face at x ≈ 0.22)."""
    bm = bmesh.new()
    x0, x1 = 0.205, 0.30
    dep, midx = x1 - x0, (x0 + x1) / 2
    s = 1.15
    arm, th = 0.30 * s, 0.085 * s
    for sgn in (+1, -1):                      # two bars → a chevron, apex at +Y (screen-right)
        box(bm, (dep, arm, th), loc=(midx, -0.16, sgn * 0.115),
            rot=(-sgn * math.radians(42), 0, 0))
    box(bm, (dep, 0.40, 0.085), loc=(midx, 0.30, -0.16))   # the underscore cursor
    ob = finish(bm, "GlyphCodex")
    bevel(ob, 0.012, 1, angle_deg=30.0)
    shade(ob, 25.0)
    return ob


def build_glyph_opencode():
    """The window 'glass' filling the frame — one emissive fill (the shared Glyph mat).
    'o' and 'x' rows both light up; on the dark acts this is what glows inside OpenCode."""
    ob = finish(_oc_cells({'o', 'x'}), "GlyphOpenCode")
    bevel(ob, 0.02, 1, angle_deg=35)
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
    R = Matrix.Rotation(-a, 4, 'Z') @ Matrix.Rotation(-TILT[slot], 4, 'Y')
    engine.data.transform(R)
    glyph.data.transform(R)
    engine.location = pos
    glyph.parent = engine
    glyph.matrix_parent_inverse = Matrix.Identity(4)


def report_frame():
    """
    Print exactly what scene.js computes, because 'the rig reads denser' is a claim.
    scene.js: scale = 3 / max(bbox), then engines swing out to radius·(1 + (1−orbit)·0.55).
    The last line is the number the director's framing is tuned against — if it grows,
    the hero crops, and that is the ONE way this round could break the page.
    """
    pts = [ob.matrix_world @ Vector(c) for ob in bpy.context.scene.objects
           if ob.type == 'MESH' for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = hi - lo
    k = 3.0 / max(size.x, size.y, size.z)

    print(f"### FRAME bbox(gltf x,y,z) = {size.x:.2f} {size.z:.2f} {size.y:.2f}  -> scale {k:.4f}")
    worst = 0.0
    for ob in bpy.context.scene.objects:
        if ob.name in ("Router", "RouterCage"):
            b = [ob.matrix_world @ Vector(v) for v in ob.bound_box]
            d = max(max(p[i] for p in b) - min(p[i] for p in b) for i in range(3))
            print(f"###   {ob.name:<15} {d * k:.2f} across            (normalized)")
        if not ob.name.startswith("Engine"):
            continue
        c = sum(((ob.matrix_world @ Vector(v)) for v in ob.bound_box), Vector()) / 8
        h = max((ob.matrix_world @ Vector(v) - c).length for v in ob.bound_box)
        b = [ob.matrix_world @ Vector(v) for v in ob.bound_box]
        dims = (max(p.x for p in b) - min(p.x for p in b),
                max(p.z for p in b) - min(p.z for p in b))   # gltf: x wide, y tall = blender z
        print(f"###   {ob.name:<15} {dims[0] * k:.2f} wide x {dims[1] * k:.2f} tall  (normalized)")
        # widest act: orbit 0 pushes the ring out by 55%, split adds 1.5 on top
        worst = max(worst, (RING_R * 1.55 + h) * k)
    print(f"### FRAME worst-case rig half-extent at orbit=0: {worst:.2f}  (of a 3.00 box)")


def main():
    # empty scene, factory startup, but WITHOUT resetting user prefs (read_factory_settings
    # would) — works both headless (-b --factory-startup) and inside the live Blender.
    bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)

    mats = {
        # emit_strength is 1.2, not 3.0, and that is a PREVIEW decision, not a page one:
        # scene.js overwrites `emissiveIntensity` every frame from the load spring, so the
        # exported strength never reaches the visitor. All 3.0 did was blow the core to
        # white in preview.py and hide the very facets I was there to inspect — a render
        # that lies to you about the thing you built it to check.
        "RouterCore":    pbr("RouterCore", COL["core"], 0.22, 0.0,
                             emit=COL["coreEm"], emit_strength=1.2),
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
    report_frame()

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
