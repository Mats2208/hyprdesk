"""
preview.py — review renders. Not part of the build; nothing it does touches the .glb.

    & "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" -b --factory-startup -P scripts\\preview.py -- OUTDIR

Runs build_model.py, then photographs the result from the cameras that actually matter.

THE POINT OF THE SOLO + SQUINT PASSES. "The three engines are distinguishable" is a claim,
and the only honest test of it is the one the visitor performs: three small shapes, in
motion, mostly out of focus. So this renders each shell ALONE, and then all three at
200 px in flat black — no colour, no material, no light, nothing but MASS. If they are not
telling apart there, they are not telling apart, and no amount of "it's correct in Blender"
fixes that.
"""
import bpy
import math
import os
import sys
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True   # don't drop a __pycache__/ into someone else's git status

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_model as B          # noqa: E402  — importing it IS the build

OUT = os.path.abspath((sys.argv[sys.argv.index("--") + 1:] or ["preview"])[0])
SC = bpy.context.scene


def engine_enum(prefer=('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES')):
    valid = bpy.types.Scene.bl_rna.properties['render'].fixed_type \
              .properties['engine'].enum_items.keys()
    return next((e for e in prefer if e in valid), list(valid)[0])


def gltf_to_blender(v):
    """The hero camera is specified in glTF space (+Y up). Blender is Z-up."""
    x, y, z = v
    return Vector((x, -z, y))


def look_at(cam, target):
    d = cam.location - Vector(target)
    cam.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()


def studio():
    for name, loc, energy, size in (
        ("key",  (4.0, -6.0, 5.0), 900, 6.0),
        ("fill", (-6.0, -3.0, 1.0), 220, 8.0),
        ("rim",  (-1.0, 7.0, 3.5), 500, 5.0),
    ):
        d = bpy.data.lights.new(name, 'AREA')
        d.energy, d.size = energy, size
        o = bpy.data.objects.new(name, d)
        o.location = loc
        bpy.context.collection.objects.link(o)
        look_at(o, (0, 0, 0))
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.07, 1)
    SC.world = w


def only(names):
    """Show just these meshes. Returns a restore fn."""
    was = {o.name: o.hide_render for o in SC.objects if o.type == 'MESH'}
    for o in SC.objects:
        if o.type == 'MESH':
            o.hide_render = names is not None and o.name not in names
    return lambda: [setattr(SC.objects[n], 'hide_render', v) for n, v in was.items()]


def shot(name, loc, target, fov_deg, res=(1100, 720), flat=False, show=None):
    restore = only(show)
    cam_d = bpy.data.cameras.new(name)
    cam_d.lens_unit = 'FOV'
    cam_d.angle = math.radians(fov_deg)
    span = 6.0
    cam_d.clip_start = span * 0.01          # never hardcode 0.1 — see the skill's pitfalls
    cam_d.clip_end = span * 100
    cam = bpy.data.objects.new(name, cam_d)
    cam.location = loc
    bpy.context.collection.objects.link(cam)
    look_at(cam, target)

    SC.camera = cam
    SC.render.engine = engine_enum()
    SC.render.resolution_x, SC.render.resolution_y = res
    SC.render.film_transparent = False
    SC.view_settings.view_transform = 'Filmic'      # AgX eats colour; Filmic ≈ three.js ACES
    SC.view_settings.look = 'None'
    if hasattr(SC, "eevee"):
        SC.eevee.taa_render_samples = 64
    SC.display_settings.display_device = 'sRGB'
    SC.world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.07, 1)

    if flat:
        SC.render.engine = 'BLENDER_WORKBENCH'
        SC.display.shading.light = 'FLAT'
        SC.display.shading.color_type = 'SINGLE'
        SC.display.shading.single_color = (0, 0, 0)
        SC.display.shading.show_object_outline = False
        # Two traps here, and both QUIETLY WEAKEN THE TEST rather than break it — which is
        # the dangerous kind, because you get a picture back and believe it:
        #  · Workbench does not evaluate the world's SHADER NODES. It reads the flat
        #    `world.color` property. Set the Background node (the obvious move, and what
        #    this file did for a whole round) and you silently get Blender's 25% theme grey
        #    instead of white.
        #  · Filmic is a film curve: it maps pure white to ~0.8. A silhouette pass graded
        #    like a photograph is a silhouette pass with the contrast turned down — exactly
        #    the knob that must not move when the question being asked is "can I still tell
        #    these apart at the worst legibility they will ever get?"
        SC.display.shading.background_type = 'WORLD'
        SC.world.color = (1, 1, 1)
        SC.view_settings.view_transform = 'Standard'

    SC.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print(f"### SHOT {SC.render.filepath}")
    bpy.data.objects.remove(cam, do_unlink=True)
    restore()


def normalize(units=3.0):
    """
    scene.js rescales the rig before it ever hits the camera, so previewing at authored
    scale frames a crop of the middle and tells you nothing.

    This must be scene.js's arithmetic EXACTLY — `3 / max(bbox extent)`, not `1.5 / max
    radius`. They differ by ~11% on this rig, which is the whole margin of the question
    being asked ("does it read bigger?"). Measuring density with a different ruler than the
    one that ships is how you convince yourself of a result you did not get.
    """
    pts = [ob.matrix_world @ Vector(c) for ob in SC.objects
           if ob.type == 'MESH' for c in ob.bound_box]
    ext = [max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3)]
    k = units / max(ext)
    for ob in SC.objects:
        if ob.type == 'MESH':
            ob.matrix_world = Matrix.Scale(k, 4) @ ob.matrix_world
    return k


os.makedirs(OUT, exist_ok=True)
K = normalize()
studio()

# ─── the rig ─────────────────────────────────────────────────────────────────
# The hero pose, verbatim from CONTRACT §2: camX 0, camY 1.4, camZ 9.0, fov 30.
shot("hero", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30)
shot("closeup", gltf_to_blender((0.9, 0.7, 3.1)), (0, 0, 0), 34)
shot("silhouette", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30, flat=True)

# The hero at the size a visitor's eye actually gives it. If the rig is a widget in the
# corner, this is the frame that says so.
shot("hero_small", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30, res=(320, 210))


ENG = [("Claude", 0), ("Codex", 1), ("OpenCode", 2)]
REST = {o.name: o.matrix_world.copy() for o in SC.objects if o.type == 'MESH'}


def act(orbit):
    """
    Pose the engines the way scene.js will, for a given `S.orbit`. Every frame above this
    line renders the AUTHORED ring (radius 2.6) — a layout that NEVER APPEARS ON THE PAGE,
    because scene.js parks dormant engines far out and draws them in as the orbit closes:

        rad = radius · (1 + (1 − orbit) · 0.55)      scale = 0.8 + 0.2 · orbit

    The hero is `orbit ≈ 0.15`. So the first thing any visitor ever sees has its engines 47%
    further out and 17% smaller than the authored layout — which means judging the hero
    composition off the authored radius is judging a frame that does not exist.
    """
    for nm, slot in ENG:
        a = 2 * math.pi * slot / 3
        p = Vector((B.RING_R * math.cos(a), -B.RING_R * math.sin(a), 0.0)) * K
        m = (Matrix.Translation(p * (1 + (1 - orbit) * 0.55))
             @ Matrix.Scale(0.8 + 0.2 * orbit, 4) @ Matrix.Translation(-p))
        for n in (f"Engine{nm}", f"Glyph{nm}"):
            SC.objects[n].matrix_world = m @ REST[n]


act(0.15)
shot("hero_act", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30)
shot("hero_act_small", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30, res=(320, 210))
shot("hero_act_flat", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30, res=(440, 290), flat=True)
for n, m in REST.items():
    SC.objects[n].matrix_world = m       # the solo pass below wants the authored radii back

# ─── each mark, SOLO — the hard gate ─────────────────────────────────────────
# Camera on the engine's real outward axis, which its own tilt lifts out of the XZ plane.
# Two angles each: square-on (the mark reads) and 3/4 (the mass reads).
FOV = 30
for nm, slot in ENG:
    a = 2 * math.pi * slot / 3
    t = B.TILT[slot]
    eng = SC.objects[f"Engine{nm}"]
    # Frame each engine from ITS OWN size, not a fixed distance. A camera parked at a
    # constant radius crops whichever engine you just made bigger — and since the point of
    # this pass is to compare MASS, the framing is the one thing that must be equal.
    bb = [eng.matrix_world @ Vector(v) for v in eng.bound_box]
    c = sum(bb, Vector()) / 8
    d = max((p - c).length for p in bb) / math.tan(math.radians(FOV) / 2) * 1.30
    out = Vector((math.cos(a) * math.cos(t), -math.sin(a) * math.cos(t), math.sin(t)))
    side = Vector((-math.sin(a), -math.cos(a), 0.0))
    q34 = (out * 1.5 + side * 1.9 + Vector((0, 0, 1)) * 1.1).normalized()
    meshes = {f"Engine{nm}", f"Glyph{nm}"}
    shot(f"solo_{nm}", c + out * d, c, FOV, res=(760, 760), show=meshes)
    shot(f"solo_{nm}_34", c + q34 * d, c, FOV, res=(760, 760), show=meshes)
    # THE SQUINT TEST. 200 px, flat black, no colour, no light, no material. Mass or nothing.
    shot(f"squint_{nm}", c + q34 * d, c, FOV, res=(200, 200), flat=True, show=meshes)
    # ...and the same test from DEAD SIDE-ON, which is the phase that kills a ring: seen
    # edge-on, a single ring is a solid bar. The orbit sweeps every engine through this
    # angle every 95 s, so if the identity does not survive here it does not survive.
    shot(f"squint_{nm}_edge", c + side * d, c, FOV, res=(200, 200), flat=True, show=meshes)
