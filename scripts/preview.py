"""
preview.py — review renders. Not part of the build; nothing it does touches the .glb.

    & "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" -b --factory-startup -P scripts\\preview.py -- OUTDIR

Runs build_model.py, then photographs the result from the cameras that actually matter:
the hero framing scene.js uses, a close-up (this ships in extreme close-up), and a
silhouette pass — colour stripped, because "you can tell the three engines apart with the
colour gone" is a claim you have to be able to check, not assert.
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
    bpy.context.scene.world = w


def shot(name, loc, target, fov_deg, res=(1100, 720), flat=False):
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

    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = engine_enum()
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Filmic'      # AgX eats colour; Filmic ≈ three.js ACES
    sc.view_settings.look = 'None'
    if hasattr(sc, "eevee"):
        sc.eevee.taa_render_samples = 64
    sc.display_settings.display_device = 'sRGB'

    if flat:
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'FLAT'
        sc.display.shading.color_type = 'SINGLE'
        sc.display.shading.single_color = (0, 0, 0)
        sc.display.shading.show_object_outline = False
        sc.world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
        sc.render.film_transparent = False

    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print(f"### SHOT {sc.render.filepath}")
    bpy.data.objects.remove(cam, do_unlink=True)


def normalize(units=3.0):
    """
    scene.js rescales the rig before it ever hits the camera. Preview it at authored scale
    and the contract's hero camera frames a crop of the middle, which tells you nothing.
    """
    r = max((ob.matrix_world @ Vector(c)).length
            for ob in bpy.context.scene.objects if ob.type == 'MESH'
            for c in ob.bound_box)
    k = (units / 2) / r
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            ob.matrix_world = Matrix.Scale(k, 4) @ ob.matrix_world
    return k


os.makedirs(OUT, exist_ok=True)
K = normalize()
studio()

# The hero pose, verbatim from CONTRACT §2: camX 0, camY 1.4, camZ 9.0, fov 30.
shot("hero", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30)

# The close-up the whole page is built around. Flaws hide at a distance.
shot("closeup", gltf_to_blender((0.9, 0.7, 3.1)), (0, 0, 0), 34)

# Engine 0 (Claude) square-on — what focusEngine(0) swings to the front. The camera sits on
# the engine's real outward axis, which the 12° tilt lifts out of the XZ plane.
t = B.ENGINE_TILT
n = Vector((math.cos(t), math.sin(t), 0.0))
shot("engine0", gltf_to_blender(Vector((B.RING_R, 0, 0)) * K + n * 2.1),
     Vector((B.RING_R, 0, 0)) * K, 30)

# Colour stripped. If the three engines aren't three different shapes, it shows here.
shot("silhouette", gltf_to_blender((0, 1.4, 9.0)), (0, 0, 0), 30, flat=True)
