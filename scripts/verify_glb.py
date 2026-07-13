"""
verify_glb.py — read the CONTRACT back OUT of the shipped file. Stdlib only, no Blender.

    python scripts\\verify_glb.py

This exists because "my export code sets the names" is a claim, not a result. The names in
public/models/hyprdesk.glb are the interface three other workers compile against, so they
get read out of the actual bytes and checked against CONTRACT.md §6.

Draco leaves the accessors in the JSON chunk (the spec requires it — the bufferView is what
moves into the extension), so the triangle count is still readable here without decoding.
"""
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, "public", "models", "hyprdesk.glb")

# CONTRACT.md §6 — mesh -> material. Frozen.
EXPECT = {
    "Router":         "RouterCore",
    "RouterCage":     "Cage",
    "EngineClaude":   "ShellClaude",
    "EngineCodex":    "ShellCodex",
    "EngineOpenCode": "ShellOpenCode",
    "GlyphClaude":    "Glyph",
    "GlyphCodex":     "Glyph",
    "GlyphOpenCode":  "Glyph",
}
LIMIT_KB = 150


def read_json_chunk(path):
    with open(path, "rb") as f:
        magic, version, _ = struct.unpack("<III", f.read(12))
        assert magic == 0x46546C67, "not a GLB"
        assert version == 2, f"glTF version {version}"
        length, kind = struct.unpack("<II", f.read(8))
        assert kind == 0x4E4F534A, "first chunk is not JSON"
        return json.loads(f.read(length))


def main():
    size_kb = os.path.getsize(GLB) / 1024
    g = read_json_chunk(GLB)
    mats = [m["name"] for m in g.get("materials", [])]
    ok = True

    # Nodes carry the transform, so this is also where "scale == 1,1,1" gets checked.
    node_of = {}
    for i, n in enumerate(g["nodes"]):
        if "mesh" in n:
            node_of[g["meshes"][n["mesh"]]["name"]] = (i, n)
    parent_of = {c: i for i, n in enumerate(g["nodes"]) for c in n.get("children", [])}

    print(f"file      : public/models/hyprdesk.glb  {size_kb:.1f} KB  (limit {LIMIT_KB})")
    print(f"draco     : {'KHR_draco_mesh_compression' in g.get('extensionsUsed', [])}")
    print(f"images    : {len(g.get('images', []))}   samplers: {len(g.get('samplers', []))}")
    print(f"materials : {sorted(mats)}")
    print()
    print(f"{'MESH':<16} {'MATERIAL':<15} {'TRIS':>7}  {'UVs':>4}  PARENT           NODE TRS")
    print("-" * 100)

    total = 0
    for mesh in g["meshes"]:
        name = mesh["name"]
        for prim in mesh["primitives"]:
            tris = g["accessors"][prim["indices"]]["count"] // 3
            total += tris
            mat = mats[prim["material"]] if "material" in prim else None
            uvs = sum(1 for a in prim["attributes"] if a.startswith("TEXCOORD"))
            idx, node = node_of[name]
            par = parent_of.get(idx)
            pname = g["nodes"][par].get("name", "?") if par is not None else "(root)"
            trs = (f"t={[round(v, 3) for v in node.get('translation', [0, 0, 0])]}"
                   f" s={[round(v, 3) for v in node.get('scale', [1, 1, 1])]}"
                   f" r={'yes' if 'rotation' in node else 'identity'}")
            print(f"{name:<16} {str(mat):<15} {tris:>7,}  {uvs:>4}  {pname:<16} {trs}")

            if EXPECT.get(name) != mat:
                print(f"   !! expected material {EXPECT.get(name)!r}, got {mat!r}")
                ok = False
            if uvs:
                print("   !! has UVs — the contract says no UV maps")
                ok = False
            if node.get("scale", [1, 1, 1]) != [1, 1, 1]:
                print("   !! node scale is not 1,1,1 — transforms were not applied")
                ok = False

    print("-" * 100)
    print(f"{'TOTAL':<16} {'':<15} {total:>7,}")
    print()

    missing = set(EXPECT) - {m["name"] for m in g["meshes"]}
    extra = {m["name"] for m in g["meshes"]} - set(EXPECT)
    if missing:
        print(f"!! missing meshes: {sorted(missing)}")
        ok = False
    if extra:
        print(f"!! unexpected meshes: {sorted(extra)}")
        ok = False

    # The Glyph material must be ONE instance shared by three meshes; the three shells must
    # NOT be, or the engine picker would tint all three at once (CONTRACT §6).
    glyph_ids = {p["material"] for m in g["meshes"] if m["name"].startswith("Glyph")
                 for p in m["primitives"]}
    shell_ids = {p["material"] for m in g["meshes"] if m["name"].startswith("Engine")
                 for p in m["primitives"]}
    print(f"Glyph shared across the 3 marks : {len(glyph_ids) == 1}")
    print(f"Shells are 3 separate materials : {len(shell_ids) == 3}")
    ok &= len(glyph_ids) == 1 and len(shell_ids) == 3

    if size_kb > LIMIT_KB:
        print(f"!! {size_kb:.1f} KB is over the {LIMIT_KB} KB budget")
        ok = False

    print("\n" + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


sys.exit(main())
