/* ══════════════════════════════════════════════════════════════
   scene.js — the product studio. Owned by: `scene` worker.

   THE RIG IS SUSPENDED IN SPACE. There is no ground, and there is
   no cast shadow. A hard shadow on an invisible floor answers a
   question nobody asked — it was lifted from a reference project
   where the product SITS ON A TABLE, and it read as a smudge
   because a smudge is what it was.

   So the object is separated from the background the way a floating
   object actually is: a RIM and a KICKER carve the silhouette, a
   HEMISPHERE fill gives the forms a top-to-bottom weight, the
   environment does real work in the reflections, and screen-space
   AO (GTAO) darkens the places the rig occludes ITSELF — inside the
   cage lattice, under the engines, in the engraved glyphs.

   S is written by main.js's poseFromScroll() and READ here. Never
   written from this file. The links and the packets are procedural
   (they are not in the .glb) because they must react to scroll.

   The tunnel is a SIMULATION, not a loop: the packet rate is driven
   by S.flow and |S.scrollVel|, and the core's load is an underdamped
   spring–damper (ζ ≈ 0.3) that flares on a burst and settles alone.
   A simulation accumulates state, so every input is sanitized and
   the state heals itself (CONTRACT.md §7).
   ══════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const ENGINES = [
  { id: 'claude', name: 'Claude', mesh: 'EngineClaude', hex: '#D97757', rough: 0.34,
    accent: '#C2410C', stage: '#F6E7DE', note: 'Deep reasoning, architecture, cross-cutting code.' },
  { id: 'codex', name: 'Codex', mesh: 'EngineCodex', hex: '#6366F1', rough: 0.30,
    accent: '#4338CA', stage: '#E4E5FB', note: 'Precise implementation — and real raster image generation.' },
  { id: 'opencode', name: 'OpenCode', mesh: 'EngineOpenCode', hex: '#7C5CFF', rough: 0.38,
    accent: '#6D28D9', stage: '#E7E2FB', note: 'Third-party models: whatever provider you are authed against.' },
];

/** Router core projected to CSS px. The halo follows it. */
export const SCREEN = { x: 0, y: 0, d: 0 };

export const S = {
  rotY: 0,
  camX: 0, camY: 1.4, camZ: 9.0,
  ty: 0,
  fov: 30,
  groupX: 0.95, groupY: 0,

  orbit: 0,
  wire: 0,
  flow: 0,
  xray: 0,
  split: 0,

  dark: 0,
  stageOp: 1,
  shadowOp: 0.3, // DEAD. There is no ground and no cast shadow. Nothing in this file reads
                 // it; it stays only so the frozen POSE table keeps writing somewhere real
                 // until the router strips it from POSE and CONTRACT.md §2.
  keyInt: 2.6,
  envInt: 0.9,
  expo: 1.0,
  glow: 1,       // emissive multiplier of the router core — also ramps the bloom
  idleSpin: 1,

  scrollVel: 0,
  mouseX: 0, mouseY: 0,
};

export const LIGHT_BG = new THREE.Color('#F2F1ED');
export const DARK_BG = new THREE.Color('#0E0F11');

/** Engines sit on a ring of radius 2.6, 120° apart, starting at +X (model units). */
export const RING = 2.6;
export const engineAngle = (i) => (i * Math.PI * 2) / 3;

const CORE_HEX = '#9FE3FF';        // the core's own light, if the .glb ships no emissive
const MAX_PACKETS = 96;            // pool. At the wildest scroll ~55 are live.

/** The rig's world size. Bigger than a widget: the object IS the argument. */
const RIG_SIZE = 5.4;

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = THREE.MathUtils.clamp;

/** glTF hands us MeshStandardMaterial; the studio wants clearcoat (that is where the
    long lacquer highlight comes from). Upgrade in place, keeping the name. */
function toPhysical(m, extra) {
  if (m.isMeshPhysicalMaterial) { Object.assign(m, extra); m.needsUpdate = true; return m; }
  const p = new THREE.MeshPhysicalMaterial({
    name: m.name,
    color: m.color ? m.color.clone() : new THREE.Color('#ffffff'),
    roughness: fin(m.roughness, 0.5),
    metalness: fin(m.metalness, 0),
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color('#000000'),
    emissiveIntensity: fin(m.emissiveIntensity, 1),
    flatShading: !!m.flatShading,
    side: m.side,
    ...extra,
  });
  return p;
}

export async function initScene({ canvas, onProgress }) {
  RectAreaLightUniformsLib.init();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // No shadow map. Nothing casts, nothing receives — see the header.

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(S.fov, 1, 0.1, 100);
  camera.position.set(S.camX, S.camY, S.camZ);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  /* ─── The studio: an object hanging in the air ───────────────── */

  /* HEMISPHERE, not ambient. A flat ambient term lights the underside of a floating
     object exactly as hard as its top, which is precisely what makes a render look
     like a sticker. Sky above / deep shade below gives every form a top-to-bottom
     falloff for free — it is the cheapest "weight" there is, and it costs one light. */
  const fill = new THREE.HemisphereLight(0xEAF2FF, 0x14171B, 0.85);
  scene.add(fill);

  /* Key: a soft 3/4 from the upper front-left. It shapes, it no longer casts, so it is
     free to sit where it flatters instead of where a shadow would have landed. A
     DirectionalLight only cares about its DIRECTION, so it does not need to follow the
     rig across groupX — the whole "the frustum rides the rig" apparatus went out with
     the shadow map. */
  const key = new THREE.DirectionalLight(0xFFF6EC, S.keyInt);
  key.position.set(-3.4, 5.6, 5.2);
  scene.add(key);

  // softboxes: the long clean highlights on the cage come from HERE, not from the env map
  const boxL = new THREE.RectAreaLight(0xffffff, 3.0, 4.0, 6.5);
  boxL.position.set(-4.6, 2.4, 4.2);
  boxL.lookAt(0, 0.2, 0);
  scene.add(boxL);

  const boxR = new THREE.RectAreaLight(0xF2F6FF, 1.9, 2.4, 6.5);
  boxR.position.set(4.8, 2.0, 2.8);
  boxR.lookAt(0, 0.2, 0);
  scene.add(boxR);

  /* RIM + KICKER — the two lights that do the job the shadow was pretending to do.
     A floating object is read against its background by its EDGE, and which edge you
     have to draw depends on the background:
       · dark page  → a bright rim IS the silhouette. Both lights ramp UP with `dark`.
       · light page → a bright rim on a near-white background separates nothing; there
         the separation comes from the hemisphere's ground shade and the AO. Hence the
         small baseline, not zero: enough to keep a specular edge alive, not enough to
         glow.
     Two of them, from opposite backs, so no engine can end up with a dead silhouette
     wherever the orbit has carried it. */
  const rim = new THREE.DirectionalLight(0x9DBEFF, 0);      // cold, back-left
  rim.position.set(-5.0, 2.6, -5.4);
  scene.add(rim);

  const kick = new THREE.DirectionalLight(0xFFD9B0, 0);     // warm, back-right, lower
  kick.position.set(5.6, -0.8, -4.2);
  scene.add(kick);

  const group = new THREE.Group();
  scene.add(group);

  /* ─── The model ─────────────────────────────────────────────── */

  // No fallback: if the model is gone, initScene REJECTS and main.js degrades the
  // page to a readable, 3D-less page. A silent box of primitives would be worse.
  //
  // BASE_URL, not '/': on GitHub Pages this ships under /hyprdesk/, and an absolute '/models/…'
  // would 404 there. Vite rewrites asset paths it can see in HTML/CSS — a string inside JS it
  // cannot. These two are the only paths in the codebase that Vite can't fix for us.
  const BASE = import.meta.env.BASE_URL;
  const draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`);
  const gltf = await new GLTFLoader().setDRACOLoader(draco)
    .loadAsync(`${BASE}models/hyprdesk.glb`, (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); });
  const model = gltf.scene;

  const parts = {};
  const mats = {};
  const meshesOf = {};                 // material name → meshes carrying it
  model.traverse((o) => {
    if (!o.isMesh) return;
    parts[o.name] = o;
    const n = o.material?.name;
    if (!n) return;
    mats[n] = o.material;              // by material NAME. Never traverse-paint.
    (meshesOf[n] ??= []).push(o);
  });

  /** Swap a material by NAME on exactly the meshes that carry it. */
  const swap = (name, next) => {
    if (!next || !meshesOf[name]) return;
    mats[name] = next;
    for (const m of meshesOf[name]) m.material = next;
  };

  // Cage: real metal. The softboxes need somewhere to land.
  if (mats.Cage) swap('Cage', toPhysical(mats.Cage, { metalness: 1, roughness: 0.24, envMapIntensity: 1.6, clearcoat: 0.3, clearcoatRoughness: 0.2 }));

  // Core: the emissive. `glow` drives its intensity — it is the LOAD, not a sin().
  if (mats.RouterCore) {
    const core = toPhysical(mats.RouterCore, { roughness: 0.16, metalness: 0, envMapIntensity: 1.2 });
    if (core.emissive.getHex() === 0x000000) core.emissive.set(CORE_HEX);
    core.toneMapped = true;
    swap('RouterCore', core);
  }

  // Shells: three SEPARATE materials — the picker tints the active one alone.
  for (const e of ENGINES) {
    const n = `Shell${e.name}`;
    if (!mats[n]) continue;
    const m = toPhysical(mats[n], {
      roughness: e.rough, metalness: 0.12, clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 1.15,
    });
    m.color.set(e.hex);
    m.emissive.set(e.hex);
    m.emissiveIntensity = 0;
    swap(n, m);
  }

  if (mats.Glyph) {
    const g = toPhysical(mats.Glyph, { roughness: 0.45, metalness: 0.1 });
    if (g.emissive.getHex() === 0x000000) g.emissive.set('#F2F1ED');
    g.emissiveIntensity = Math.max(fin(g.emissiveIntensity), 0.3);
    swap('Glyph', g);
  }

  // Normalize: the rig is RIG_SIZE units across, centred on the router.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = RIG_SIZE / Math.max(size.x, size.y, size.z, 0.001);
  model.scale.setScalar(scale);
  if (parts.Router) {
    const c = new THREE.Box3().setFromObject(parts.Router).getCenter(new THREE.Vector3());
    model.position.set(-c.x * scale, -c.y * scale, -c.z * scale);
  }
  group.add(model);
  model.updateWorldMatrix(true, true);

  /* ─── Engine rigs: a pivot at each engine so it can orbit, split and breathe.
         `attach` preserves the world transform, so this works whether the .glb
         bakes the ring into the vertices or into the object transform. ─────── */

  const RIGS = ENGINES.map((e, i) => {
    const shell = parts[e.mesh];
    const glyph = parts[`Glyph${e.name}`];
    const rig = new THREE.Group();
    rig.name = `rig-${e.id}`;

    const a0 = engineAngle(i);
    const c = shell
      ? model.worldToLocal(new THREE.Box3().setFromObject(shell).getCenter(new THREE.Vector3()))
      : new THREE.Vector3(Math.cos(a0) * RING, 0, Math.sin(a0) * RING);

    rig.position.copy(c);
    model.add(rig);
    rig.updateWorldMatrix(true, false);
    for (const m of [shell, glyph]) if (m) rig.attach(m);

    const r = Math.hypot(c.x, c.z) || RING;
    return {
      rig,
      shell,
      radius: r,
      baseY: c.y,
      angle: Math.atan2(c.z, c.x),
      focus: i === 0 ? 1 : 0,          // lerped toward the picker's choice
      hex: new THREE.Color(e.hex),
      a: new THREE.Vector3(),          // link start (core surface) — model space
      b: new THREE.Vector3(),          // link end   (engine)
      perp: new THREE.Vector3(),
    };
  });

  /* Radii back in MODEL units (the boxes are world-space, the model is scaled), and
     DERIVED from the real geometry — the cage is not a sphere, so which extent you
     take matters:
       · the halo is a SPHERE, so it must clear the LARGEST half-extent, or it ends up
         buried inside a cage that is taller than it is wide.
       · the links leave in the XZ PLANE, so they anchor to the XZ radius. Anchor them
         to the largest extent instead and each wire starts floating in mid-air, a
         visible gap short of the cage it is supposed to plug into. */
  const extents = (mesh) => (mesh ? new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()) : null);
  const sphereR = (mesh, fb) => { const s = extents(mesh); return s ? (Math.max(s.x, s.y, s.z) * 0.5) / scale : fb; };
  const planeR = (mesh, fb) => { const s = extents(mesh); return s ? (Math.max(s.x, s.z) * 0.5) / scale : fb; };

  const CORE_GEO_R = sphereR(parts.Router, 0.44);
  const CAGE_R = sphereR(parts.RouterCage, CORE_GEO_R * 1.6);
  // 0.96: the wire tip ends just INSIDE the cage silhouette, so it reads as plugged in
  const CORE_R = planeR(parts.RouterCage, CAGE_R) * 0.96;

  /* ─── The framing probe. The director solves camZ/fov/groupX against THIS. ───

     Half-extents, WORLD units, measured off the real geometry — and PHASE-SWEPT, not
     sampled: the engines never stop orbiting (`phase += dt·0.12·orbit`, ~95 s per
     revolution), so a snapshot proves nothing about the frame. It cost six of seven
     acts a cropped engine last round. Walking each engine right around its own ring
     and taking the worst |x| makes `phase` (and therefore `rotY`) drop out entirely:
     the extreme of cos() is 1 wherever you started. */
  const shellHalf = RIGS.map((r) => {
    const s = extents(r.shell);
    // max of the XZ extents: the shell turns with the ring, so the face pointing at
    // the camera changes. Take the widest one and the bound holds at every phase.
    return s ? Math.max(s.x, s.z) * 0.5 : 0.35 * scale;
  });
  const cageSize = extents(parts.RouterCage) ?? extents(parts.Router);
  const CAGE_HALF_W = cageSize ? Math.max(cageSize.x, cageSize.z) * 0.5 : CAGE_R * scale;
  const MODEL_OFF = Math.abs(model.position.x);   // the router↔model-origin offset, world

  const extentAt = (orbit, split) => {
    let half = MODEL_OFF + CAGE_HALF_W;           // the router alone, if the engines tuck inside
    for (let i = 0; i < RIGS.length; i++) {
      // the SAME formula the render loop uses. If one changes, the frame is wrong again.
      const rad = RIGS[i].radius * (1 + (1 - orbit) * 0.55) + split * 1.5;
      const s = (0.8 + 0.2 * orbit) * (1 + RIGS[i].focus * 0.06);
      half = Math.max(half, MODEL_OFF + rad * scale + shellHalf[i] * s);
    }
    return half;
  };

  window.__extent = () => ({
    halfExtent: +extentAt(clamp(fin(S.orbit), 0, 1), clamp(fin(S.split), 0, 1)).toFixed(3),
    coreR: +(MODEL_OFF + CAGE_HALF_W).toFixed(3),
  });

  /* ─── The A2A links. Procedural: they must react to scroll. ──── */

  const linkGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);   // unit tube along +Y
  const LINK_R = 0.022;                                              // model units — a wire, not a pipe
  const UP = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const dir = new THREE.Vector3();

  const links = RIGS.map((r, i) => {
    const mat = new THREE.MeshBasicMaterial({
      color: r.hex.clone(), transparent: true, opacity: 0, depthWrite: false,
    });
    const mesh = new THREE.Mesh(linkGeo, mat);
    mesh.frustumCulled = false;
    mesh.name = `Link${ENGINES[i].name}`;
    model.add(mesh);
    return mesh;
  });

  /* ─── The packets. One InstancedMesh, tinted per link. ───────── */

  const pkMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
  const packets = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.065, 0), pkMat, MAX_PACKETS);
  packets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  packets.frustumCulled = false;
  model.add(packets);
  for (let i = 0; i < MAX_PACKETS; i++) packets.setColorAt(i, RIGS[0].hex);
  packets.instanceColor.needsUpdate = true;

  const POOL = Array.from({ length: MAX_PACKETS }, () => ({ live: false, link: 0, t: 0, dir: 1, speed: 1, jit: 0 }));
  const M = new THREE.Matrix4();
  const V = new THREE.Vector3();
  const Q0 = new THREE.Quaternion();
  const SC = new THREE.Vector3();
  const ZERO = new THREE.Vector3(0, 0, 0);

  /* THE HALO IS GONE. It was an additive fresnel ball around the core whose entire job
     was, in its own words, "the bloom read without paying for a post pass". We now pay
     for the post pass. Kept alongside a real threshold bloom it does not add glow, it
     DOUBLES it: the first render of this act came back with the cage swallowed by a
     white sun and the whole frame washed cream. Two glows is one glow too many.

     The colour still matters, though — it is the core's own emissive (the .glb ships a
     warm amber), and the wires lerp toward it as they run hot. Hard-coding a cyan here
     would wrap an amber core in a blue glow and light it with a blue lamp. */
  const GLOW = mats.RouterCore?.emissive?.clone() ?? new THREE.Color(CORE_HEX);

  /* The core is a light source, not a painted sphere: under load it lights the cage
     from the INSIDE, and that spill through the open lattice is what the glow actually
     reads as. It lives in `group` (world scale), not in `model` — PointLight.distance
     is world. Its intensity is the LOAD, and only mildly the `glow` dial: `glow` is
     what the core EMITS and what the bloom picks up, not how hard it floods the room.
     Wired to `glow` directly it hit intensity 18 in the tunnel and every engine came
     back the same pale peach. */
  const coreLight = new THREE.PointLight(GLOW.clone(), 0, 8, 2);
  group.add(coreLight);

  /* ─── X-ray: the shells go ghost so the packets read from outside.
         depthWrite=false is the whole point — otherwise the front wall
         z-buffers over the packets and you see nothing. ───────────── */
  const ghosts = [
    { m: mats.Cage, min: 0.20 },
    ...ENGINES.map((e) => ({ m: mats[`Shell${e.name}`], min: 0.16 })),
    { m: mats.Glyph, min: 0.55 },
  ].filter((g) => g.m);

  function applyXray(x) {
    for (const g of ghosts) {
      const want = x > 0.01;
      if (g.m.transparent !== want) { g.m.transparent = want; g.m.needsUpdate = true; }
      g.m.opacity = 1 - x * (1 - g.min);
      g.m.depthWrite = !want;
    }
  }

  /* ═══ POST ══════════════════════════════════════════════════════
     RenderPass → GTAO → bloom → OutputPass.

     Tone mapping now happens ONCE, in OutputPass, on the HDR buffer — a render
     target keeps the materials linear and un-tonemapped, which is exactly what the
     bloom threshold wants to see. That is also why nothing in here sets
     `toneMapped: false` any more: in the composer that flag does nothing on the way
     into the buffer, and it would then make the packets and the halo the only things
     on screen NOT graded by ACES.

     The two passes never both cost:
       · AO is worth paying for in the LIT acts and is invisible at near-black, so it
         fades out with `dark`.
       · bloom is worth paying for in the DARK acts and would only bruise the lit ones,
         so it fades IN with `dark`.
     Each is switched OFF, not merely set to zero, outside its band — a Pass with
     `enabled = false` is skipped entirely by the composer, and both are additive/
     multiplicative identities at zero, so the switch is invisible.

     MSAA lives on the composer's own target (`samples: 4`). The canvas's `antialias`
     only ever applied to the default framebuffer, and the default framebuffer now
     receives one full-screen quad — without this the rig comes back jagged. */
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));

  /* GTAO at HALF resolution. AO is a low-frequency signal — it is denoised and blurred
     anyway — so full res buys nothing and costs 4×. */
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.output = GTAOPass.OUTPUT.Default;
  ao.updateGtaoMaterial({
    radius: 0.34,             // WORLD units, on a rig ~5.4 across: contact darkening, not a mood
    distanceExponent: 1.0,
    thickness: 0.7,
    scale: 1.15,
    samples: 16,
    screenSpaceRadius: false,
  });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, samples: 16 });

  /* The AO's G-buffer is a full re-render of the scene with a normal material — and it
     does NOT know that the links are wires and the packets are sparks rather than solid
     bodies. Left in, a packet drifting past the cage punches a dark hole in it. GTAOPass
     only hides points and lines on its own, so hide the rest of the fakes here.
     `restoreVisibility` reads the cache `overrideVisibility` just filled, so the
     originals come back untouched. */
  const AO_HIDE = [packets, ...links];
  const baseOverride = ao.overrideVisibility.bind(ao);
  ao.overrideVisibility = () => {
    baseOverride();
    for (const o of AO_HIDE) o.visible = false;
  };
  composer.addPass(ao);

  /* Threshold bloom. It is selective by CONSTRUCTION, not by a second render: the only
     things in the frame that clear the threshold are the emissives — the core, the
     engraved glyphs, the wires and the packets — because they are the only things
     pushed above 1.0 in linear space (see NIGHT_* below). The shells stay under it,
     so they carve, they don't smear into glowing blobs.

     RADIUS 0.30, not the usual 0.4–0.8. The hot things here are SMALL — a core, three
     inlays, a stream of sparks — and a wide radius does not make small things glow, it
     makes the whole frame a haze with the object dissolved somewhere inside it. Tight
     radius, high threshold: the light stays attached to the thing emitting it. */
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.30, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ─── The picker ─────────────────────────────────────────────── */

  let focusIdx = 0;
  function focusEngine(i) { focusIdx = clamp(Math.round(fin(i)), 0, RIGS.length - 1); }

  /* ─── The simulation. Load = underdamped spring–damper (ζ ≈ 0.3):
         it flares on a burst of scroll and settles on its own. ───── */
  const P = { load: 0, vel: 0, spawn: 0, n: 0, live: 0 };
  const K = 30;
  const D = 2 * 0.3 * Math.sqrt(K);   // ζ = D / (2√K) = 0.3

  function stepFlow(dt, time, flow, wire, sv) {
    // A simulation ACCUMULATES STATE: one NaN frame latches forever and it fails
    // SILENTLY. Sanitize the inputs (done by the caller) AND heal the state.
    if (![P.load, P.vel, P.spawn].every(Number.isFinite)) { P.load = P.vel = P.spawn = 0; }

    // THE SCROLL IS THE TRAFFIC. Without the velocity term the tunnel would sit
    // perfectly still exactly while the visitor reads the paragraph about it.
    const rate = flow * (9 + sv * 5);          // packets/sec, all links
    P.spawn += rate * dt;

    while (P.spawn >= 1) {
      P.spawn -= 1;
      const idx = POOL.findIndex((x) => !x.live);
      if (idx < 0) { P.spawn = 0; break; }       // pool full: drop the spawn, don't queue it
      const p = POOL[idx];
      const n = ++P.n;
      p.live = true;
      p.link = n % 4 === 0 ? focusIdx : n % 3;   // the picked engine gets extra traffic
      p.dir = n & 1 ? 1 : -1;                    // router → engine, and back
      p.t = p.dir > 0 ? 0 : 1;
      p.speed = 0.5 + 0.5 * flow + ((n % 5) * 0.04);
      p.jit = ((n * 37) % 100) / 100 - 0.5;
      packets.setColorAt(idx, RIGS[p.link].hex);
      packets.instanceColor.needsUpdate = true;
    }

    let live = 0;
    for (let i = 0; i < MAX_PACKETS; i++) {
      const p = POOL[i];
      if (p.live) {
        p.t += p.dir * p.speed * dt;
        if (!Number.isFinite(p.t)) p.live = false;
        else if (p.dir < 0 && p.t <= 0) { p.live = false; P.vel += 1.1; }  // arrival at the core → flare
        else if (p.dir > 0 && p.t >= 1) { p.live = false; }
      }
      if (!p.live) {
        M.compose(ZERO, Q0, ZERO);
      } else {
        live++;
        const r = RIGS[p.link];
        // travel along the BUILT part of the link: a half-wired link carries the
        // packet to its tip and no further. (Hiding it mid-flight pops instead.)
        V.copy(r.a).lerp(r.b, p.t * wire).addScaledVector(r.perp, p.jit * 0.10);
        V.y += Math.sin(time * 2.4 + p.jit * 9) * 0.02;
        const s = 0.75 + 0.5 * flow;
        SC.set(s, s, s);
        M.compose(V, Q0, SC);
      }
      packets.setMatrixAt(i, M);
    }
    packets.instanceMatrix.needsUpdate = true;
    P.live = live;

    // steady load from the traffic, plus the arrival impulses above
    const target = clamp(flow * 0.7 + Math.min(sv * 0.06, 0.5), 0, 1.4);
    P.vel += (K * (target - P.load) - D * P.vel) * dt;
    P.load = clamp(P.load + P.vel * dt, 0, 2.2);
    if (!Number.isFinite(P.load) || !Number.isFinite(P.vel)) { P.load = P.vel = 0; }
  }

  /* the tunnel's aliveness, verifiable from a test instead of by eyeballing it */
  window.__flow = () => ({ load: P.load, vel: P.vel, packets: P.live, spawned: P.n, focus: focusIdx });

  /* the rig, same reason: a glyph is engraved geometry riding its shell's pivot, so
     `shell → glyph` must stay RIGID while the engine orbits and splits. A test can
     watch that distance instead of squinting at a render. */
  // world CENTRE of a mesh's geometry — the glyph's origin sits on the shell's origin,
  // so comparing origins would compare nothing. The engraved mark is an offset in the
  // vertices; only the bbox centre sees it.
  const centre = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const arr = (v) => v.toArray().map((n) => +n.toFixed(4));
  window.__rigs = () => RIGS.map((r, i) => {
    const glyph = parts[`Glyph${ENGINES[i].name}`];
    const sc = r.rig.scale.x;
    const s = r.shell ? centre(r.shell) : null;
    const g = glyph ? centre(glyph) : null;
    return {
      id: ENGINES[i].id,
      shell: s ? arr(s) : null,
      glyph: g ? arr(g) : null,
      scale: +sc.toFixed(4),
      // shell↔glyph, in the rig's OWN scale. Constant ⇒ the mark rides the shell.
      gap: s && g ? +(s.distanceTo(g) / sc).toFixed(4) : null,
    };
  });

  /* ─── Framing ────────────────────────────────────────────────── */

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    // composer.setSize hands every pass DEVICE pixels — including the AO, which we then
    // put back to half. It is the one pass whose signal does not need them.
    const dpr = renderer.getPixelRatio();
    composer.setSize(innerWidth, innerHeight);
    ao.setSize(Math.max(1, Math.round((innerWidth * dpr) / 2)),
      Math.max(1, Math.round((innerHeight * dpr) / 2)));
  }
  resize();
  addEventListener('resize', resize);

  const pTop = new THREE.Vector3(), pBot = new THREE.Vector3();
  function projectRouter(gx, gy) {
    pTop.set(gx, gy + CAGE_HALF_W, 0).project(camera);
    pBot.set(gx, gy - CAGE_HALF_W, 0).project(camera);
    const yTop = (1 - (pTop.y * 0.5 + 0.5)) * innerHeight;
    const yBot = (1 - (pBot.y * 0.5 + 0.5)) * innerHeight;
    SCREEN.x = (pTop.x * 0.5 + 0.5) * innerWidth;
    SCREEN.y = (yTop + yBot) / 2;
    // CLAMPED: in the close-up acts an unclamped projection makes the halo
    // swallow the text column. The reference shipped that bug once.
    SCREEN.d = clamp(Math.abs(yBot - yTop) * 1.3, 120, Math.min(innerHeight * 0.9, innerWidth * 0.6));
  }

  /* ─── Render. ONE RAF: main.js's gsap.ticker calls this. ─────── */

  let mx = 0, my = 0, prevT = 0, phase = 0;
  const bgCol = new THREE.Color();
  const linkCol = new THREE.Color();

  function render(time) {
    const t = fin(time, prevT + 1 / 60);
    // dt from OUR OWN `time`, clamped: a backgrounded tab hands back a
    // multi-second dt that detonates the integrator.
    const dt = Math.min(Math.max(prevT ? t - prevT : 1 / 60, 1 / 240), 1 / 30);
    prevT = t;

    // read S once, sanitized. S is never written from here.
    const orbit = clamp(fin(S.orbit), 0, 1);
    const wire = clamp(fin(S.wire), 0, 1);
    const flow = clamp(fin(S.flow), 0, 1);
    const xray = clamp(fin(S.xray), 0, 1);
    const split = clamp(fin(S.split), 0, 1);
    const dark = clamp(fin(S.dark), 0, 1);
    const sv = clamp(Math.abs(fin(S.scrollVel)), 0, 10);
    const glow = clamp(fin(S.glow, 1), 0, 4);
    const gx = fin(S.groupX), gy = fin(S.groupY);

    phase += dt * 0.12 * orbit;      // the orbit drifts only once it is open
    if (!Number.isFinite(phase)) phase = 0;

    /* engines: dormant far out → full orbit → pulled onto their own branches.
       __extent's `extentAt` mirrors the two lines below. Change one, change both. */
    for (let i = 0; i < RIGS.length; i++) {
      const r = RIGS[i];
      const ang = r.angle + phase;
      const rad = r.radius * (1 + (1 - orbit) * 0.55) + split * 1.5;
      const bob = Math.sin(t * 0.55 + i * 2.1) * 0.07 * (0.35 + 0.65 * orbit);
      const branch = split * (0.6 - i * 0.35);      // stagger: each worktree on its own level

      r.focus += ((i === focusIdx ? 1 : 0) - r.focus) * Math.min(1, dt * 7);
      const s = (0.8 + 0.2 * orbit) * (1 + r.focus * 0.06);

      r.rig.position.set(Math.cos(ang) * rad, r.baseY + bob + branch, Math.sin(ang) * rad);
      r.rig.rotation.set(split * 0.12 * (i - 1), phase + split * 0.3 * (i - 1), 0);
      r.rig.scale.setScalar(s);

      /* the picked engine lights up; the others go quiet (dimmer in the studio's
         reflections). But the highlight FADES OUT as the lights go down — it is a flat
         self-lit wash, and in a near-black frame it does not read as "selected", it
         reads as a sticker pasted over the render: the one engine in the shot with no
         shading on it. The dark acts have no picker on screen anyway; there, the engine
         that matters is the one the packets are streaming to. */
      const sm = mats[`Shell${ENGINES[i].name}`];
      if (sm) {
        sm.emissiveIntensity = r.focus * 0.34 * (1 - dark * 0.72);
        sm.envMapIntensity = 0.7 + r.focus * 0.5;
      }
    }

    /* ── THE BURN ────────────────────────────────────────────────
       Emission and bloom do nothing at #f0efec — there is no headroom above a light
       page. So the burn is spent where the page pays for it: everything that is
       supposed to be LIGHT is pushed past 1.0 in linear space as `dark` closes, which
       is what makes it clear the bloom threshold and blow out instead of merely being
       the brightest shade of beige on screen. At dark = 0 every one of these is 1×,
       the bloom pass is switched off, and the lit acts are exactly the page that
       shipped. */
    const NIGHT_CORE = 1 + dark * 0.35;
    /* The WIRE stays a coloured filament and the PACKETS are the white-hot things riding
       it. Boosted equally they clip to the same white and the packet disappears into the
       wire it is travelling on — which deletes the one thing the tunnel act is about. The
       gap between these two numbers IS the shot. */
    const NIGHT_WIRE = 1 + dark * 0.6;
    const NIGHT_PACKET = 1 + dark * 3.2;

    /* links: they reach from the core out to the engine as `wire` opens */
    for (let i = 0; i < RIGS.length; i++) {
      const r = RIGS[i];
      dir.copy(r.rig.position).normalize();
      r.a.copy(dir).multiplyScalar(CORE_R);
      r.b.copy(r.rig.position);
      r.perp.set(-dir.z, 0, dir.x);                 // sideways, for the packet jitter

      const seg = V.copy(r.b).sub(r.a);
      const len = seg.length() * wire;
      const mesh = links[i];
      if (len < 1e-3 || wire < 0.01) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
        q.setFromUnitVectors(UP, seg.normalize());
        mesh.quaternion.copy(q);
        mesh.position.copy(r.a).addScaledVector(seg, len * 0.5);
        const rad = LINK_R * (0.7 + 0.5 * wire) * (1 + r.focus * 0.35);
        mesh.scale.set(rad, len, rad);

        const m = mesh.material;
        m.opacity = clamp(wire * (0.34 + 0.34 * flow + 0.22 * r.focus) * (1 + dark * 0.3), 0, 1);
        // it runs hot under traffic: the wire whitens toward the core's colour
        linkCol.copy(r.hex).lerp(GLOW, clamp(flow * 0.45 + P.load * 0.18, 0, 0.6));
        m.color.copy(linkCol).multiplyScalar(NIGHT_WIRE);
      }
    }

    stepFlow(dt, t, flow, wire, sv);
    applyXray(xray);

    pkMat.opacity = clamp(0.35 + flow * 0.65, 0, 1);
    // material.color multiplies the per-instance tint: one scalar drives all 96
    pkMat.color.setScalar(NIGHT_PACKET);

    /* glow IS the load — a spring, not a sin(). Above ~3 linear, ACES has already taken
       the core to pure white, so every unit past that buys no more brightness — it only
       buys BLOOM RADIUS, i.e. a bigger blob. Keep it just over the clip point and let
       the bloom do the work it was added to do. */
    const core = mats.RouterCore;
    if (core) core.emissiveIntensity = glow * (0.40 + P.load * 0.55) * NIGHT_CORE;
    // the engraved marks are inlays, not paint: a matte hint in the lit acts, and in the
    // dark ones the second-brightest thing in the frame — but still a MARK, still legible
    // as the glyph it is, which is the whole reason it was cut as geometry.
    if (mats.Glyph) mats.Glyph.emissiveIntensity = 0.28 + dark * 0.85 + P.load * (0.12 + dark * 0.22);
    coreLight.intensity = (0.4 + P.load * 1.7) * (0.55 + 0.25 * glow) * NIGHT_CORE;

    /* camera. No tween ever touches it. */
    mx += (fin(S.mouseX) - mx) * 0.07;
    my += (fin(S.mouseY) - my) * 0.07;
    camera.position.set(fin(S.camX) + mx * 0.45, fin(S.camY, 1.4) + my * 0.3, fin(S.camZ, 9));
    camera.lookAt(0, fin(S.ty), 0);
    const fov = fin(S.fov, 30);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

    group.rotation.y = fin(S.rotY) + Math.sin(t * 0.16) * 0.035 * fin(S.idleSpin, 1);
    group.position.set(gx, gy, 0);
    coreLight.position.copy(group.position);

    /* THE STUDIO LIGHTS GO OUT. The key, the softboxes and the environment fall away;
       the rim and the kicker come UP, because on a near-black page the silhouette is
       the only thing still drawing the object. main.js turns the page in the same frame. */
    fill.intensity = 0.85 - dark * 0.72;
    key.intensity = fin(S.keyInt, 2.6) * (1 - dark * 0.86);
    boxL.intensity = 3.0 * (1 - dark * 0.80);
    boxR.intensity = 1.9 * (1 - dark * 0.85);
    rim.intensity = 0.30 + dark * 2.7;
    kick.intensity = 0.18 + dark * 1.5;
    scene.environmentIntensity = fin(S.envInt, 0.9) * (1 - dark * 0.78);
    renderer.toneMappingExposure = fin(S.expo, 1);

    /* the two post passes, each paid for only in the acts that use it */
    const aoAmt = 1 - dark;
    ao.enabled = aoAmt > 0.02;
    ao.blendIntensity = aoAmt;

    const bloomAmt = dark * (0.22 + 0.10 * glow);
    bloom.enabled = bloomAmt > 0.02;
    bloom.strength = bloomAmt;

    bgCol.copy(LIGHT_BG).lerp(DARK_BG, dark);

    projectRouter(gx, gy);
    composer.render(dt);
    return bgCol;
  }

  focusEngine(0);

  return { render, focusEngine, scene, camera, renderer, composer, group, parts, mats, links, packets };
}
