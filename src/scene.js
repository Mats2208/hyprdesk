/* ══════════════════════════════════════════════════════════════
   scene.js — the product studio. Owned by: `scene` worker.

   Not an object floating in a void: there is GROUND, a CONTACT
   SHADOW and SOFTBOXES. That is what separates a render from
   product photography — the long clean highlights on the cage are
   the RectAreaLights, not the environment map.

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

export const ENGINES = [
  { id: 'claude', name: 'Claude', mesh: 'EngineClaude', hex: '#D97757', rough: 0.34,
    accent: '#C2410C', stage: '#F6E7DE', note: 'Deep reasoning, architecture, cross-cutting code.' },
  { id: 'codex', name: 'Codex', mesh: 'EngineCodex', hex: '#10A37F', rough: 0.30,
    accent: '#0F766E', stage: '#DCEFE9', note: 'Precise implementation — and real raster image generation.' },
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
  shadowOp: 0.3,
  keyInt: 2.6,
  envInt: 0.9,
  expo: 1.0,
  glow: 1,
  idleSpin: 1,

  scrollVel: 0,
  mouseX: 0, mouseY: 0,
};

export const LIGHT_BG = new THREE.Color('#F2F1ED');
export const DARK_BG = new THREE.Color('#0E0F11');

/** Engines sit on a ring of radius 2.6, 120° apart, starting at +X (model units). */
export const RING = 2.6;
export const engineAngle = (i) => (i * Math.PI * 2) / 3;

const CORE_HEX = '#9FE3FF';        // the core's own light
const MAX_PACKETS = 96;            // pool. At the wildest scroll ~55 are live.

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = THREE.MathUtils.clamp;

/* ponytail: primitives with the REAL names, so the page runs before the .glb
   lands. DELETE this and the try/catch below once public/models/hyprdesk.glb
   exists — initScene must then REJECT (main.js already degrades gracefully). */
function buildPlaceholder() {
  const root = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.62, 2),
    new THREE.MeshPhysicalMaterial({ name: 'RouterCore', color: '#F2F1ED', emissive: CORE_HEX, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0 })
  );
  core.name = 'Router';
  root.add(core);

  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.98, 0),
    new THREE.MeshPhysicalMaterial({ name: 'Cage', color: '#9AA1A8', metalness: 1, roughness: 0.24, flatShading: true, side: THREE.DoubleSide })
  );
  cage.name = 'RouterCage';
  root.add(cage);

  const glyphMat = new THREE.MeshPhysicalMaterial({ name: 'Glyph', color: '#111315', emissive: '#F2F1ED', emissiveIntensity: 0.25, roughness: 0.5 });

  ENGINES.forEach((e, i) => {
    const a = engineAngle(i);
    const px = Math.cos(a) * RING, pz = Math.sin(a) * RING;

    const shell = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.62, 0),
      new THREE.MeshPhysicalMaterial({ name: `Shell${e.name}`, color: e.hex, roughness: e.rough, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.25 })
    );
    shell.name = e.mesh;
    shell.position.set(px, 0, pz);
    root.add(shell);

    const glyph = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 24), glyphMat);
    glyph.name = `Glyph${e.name}`;
    glyph.position.set(px + Math.cos(a) * 0.4, 0, pz + Math.sin(a) * 0.4);
    glyph.rotation.y = -a;
    root.add(glyph);
  });

  return root;
}

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(S.fov, 1, 0.1, 100);
  camera.position.set(S.camX, S.camY, S.camZ);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  /* ─── The studio ────────────────────────────────────────────── */

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, S.keyInt);
  key.position.set(3.4, 7.5, 5.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 26;
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);

  // softboxes: the long clean highlights on the cage come from HERE, not from the env map
  const boxL = new THREE.RectAreaLight(0xffffff, 3.4, 3.0, 5.0);
  boxL.position.set(-3.6, 2.2, 3.4);
  boxL.lookAt(0, 0.2, 0);
  scene.add(boxL);

  const boxR = new THREE.RectAreaLight(0xf2f6ff, 2.2, 1.8, 5.0);
  boxR.position.set(3.8, 1.8, 2.2);
  boxR.lookAt(0, 0.2, 0);
  scene.add(boxR);

  // cold rim: only takes over once the studio lights go out
  const rim = new THREE.DirectionalLight(0x93b4ff, 0);
  rim.position.set(-4.2, 3.2, -4.6);
  scene.add(rim);

  /* Ground: takes the shadow, paints nothing. The rig SITS. */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: S.shadowOp, transparent: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const group = new THREE.Group();
  scene.add(group);

  /* ─── The model ─────────────────────────────────────────────── */

  let model;
  try {
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    const gltf = await new GLTFLoader().setDRACOLoader(draco)
      .loadAsync('/models/hyprdesk.glb', (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); });
    model = gltf.scene;
  } catch {
    console.warn('[scene] hyprdesk.glb not found — placeholder. (models worker: still baking)');
    model = buildPlaceholder();
    onProgress?.(1);
  }

  const parts = {};
  const mats = {};
  const meshesOf = {};                 // material name → meshes carrying it
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
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

  // Normalize: the rig is 3 units across, centred on the router.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 3 / Math.max(size.x, size.y, size.z, 0.001);
  model.scale.setScalar(scale);
  if (parts.Router) {
    const c = new THREE.Box3().setFromObject(parts.Router).getCenter(new THREE.Vector3());
    model.position.set(-c.x * scale, -c.y * scale, -c.z * scale);
  }
  group.add(model);
  model.updateWorldMatrix(true, true);

  // the contact shadow lands just under the rig
  const worldBox = new THREE.Box3().setFromObject(model);
  ground.position.y = worldBox.min.y - 0.12;

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

  // radii back in MODEL units (the boxes are world-space, the model is scaled)
  const radiusOf = (mesh, fb) => (mesh
    ? (new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x * 0.5) / scale
    : fb);
  const CORE_GEO_R = radiusOf(parts.Router, 0.62);
  const CAGE_R = radiusOf(parts.RouterCage, CORE_GEO_R * 1.5);
  const CORE_R = CAGE_R + 0.12;                            // where a link leaves the router
  // the halo has to clear the CAGE, or the core's load never reads from outside it
  const HALO_R = Math.max(CORE_GEO_R * 1.4, CAGE_R * 1.12);

  /* ─── The A2A links. Procedural: they must react to scroll. ──── */

  const linkGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);   // unit tube along +Y
  const LINK_R = 0.022;                                              // model units — a wire, not a pipe
  const UP = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const dir = new THREE.Vector3();

  const links = RIGS.map((r, i) => {
    const mat = new THREE.MeshBasicMaterial({
      color: r.hex.clone(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    });
    const mesh = new THREE.Mesh(linkGeo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.name = `Link${ENGINES[i].name}`;
    model.add(mesh);
    return mesh;
  });

  /* ─── The packets. One InstancedMesh, tinted per link. ───────── */

  const pkMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const packets = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.065, 0), pkMat, MAX_PACKETS);
  packets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  packets.frustumCulled = false;
  packets.castShadow = false;
  model.add(packets);
  for (let i = 0; i < MAX_PACKETS; i++) packets.setColorAt(i, RIGS[0].hex);
  packets.instanceColor.needsUpdate = true;

  const POOL = Array.from({ length: MAX_PACKETS }, () => ({ live: false, link: 0, t: 0, dir: 1, speed: 1, jit: 0 }));
  const M = new THREE.Matrix4();
  const V = new THREE.Vector3();
  const Q0 = new THREE.Quaternion();
  const SC = new THREE.Vector3();
  const ZERO = new THREE.Vector3(0, 0, 0);

  /* ─── The core's halo. A backside fresnel shell, additive: the bloom read
         without paying for a post pass (see the report — no EffectComposer). */
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uInt: { value: 0 }, uCol: { value: new THREE.Color(CORE_HEX) } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uInt; uniform vec3 uCol;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        f = pow(f, 1.7);
        gl_FragColor = vec4(uCol * f * uInt, f * uInt);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), haloMat);
  halo.frustumCulled = false;
  halo.castShadow = false;
  model.add(halo);

  /* The core is a light source, not a painted sphere: under load it lights the cage
     from the INSIDE. In the dark act this is what the glow actually reads as.
     It lives in `group` (world scale), not in `model` — PointLight.distance is world. */
  const coreLight = new THREE.PointLight(new THREE.Color(CORE_HEX), 0, 5, 2);
  coreLight.castShadow = false;
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

  /* ─── Framing ────────────────────────────────────────────────── */

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  const pTop = new THREE.Vector3(), pBot = new THREE.Vector3();
  function projectRouter(gx, gy) {
    pTop.set(gx, gy + 1.2, 0).project(camera);
    pBot.set(gx, gy - 1.2, 0).project(camera);
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

    /* engines: dormant far out → full orbit → pulled onto their own branches */
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

      // the picked engine lights up; the others go quiet (dimmer in the studio's reflections)
      const sm = mats[`Shell${ENGINES[i].name}`];
      if (sm) {
        sm.emissiveIntensity = r.focus * 0.42 * (1 + dark * 0.6);
        sm.envMapIntensity = 0.7 + r.focus * 0.5;
      }
    }

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
        linkCol.copy(r.hex).lerp(haloMat.uniforms.uCol.value, clamp(flow * 0.45 + P.load * 0.18, 0, 0.6));
        m.color.copy(linkCol);
      }
    }

    stepFlow(dt, t, flow, wire, sv);
    applyXray(xray);

    pkMat.opacity = clamp(0.35 + flow * 0.65, 0, 1);

    /* glow IS the load — a spring, not a sin() */
    const core = mats.RouterCore;
    if (core) core.emissiveIntensity = glow * (0.55 + P.load * 0.9);
    if (mats.Glyph) mats.Glyph.emissiveIntensity = 0.28 + dark * 0.35 + P.load * 0.12;
    halo.scale.setScalar(HALO_R * (1 + P.load * 0.06));
    haloMat.uniforms.uInt.value = clamp((0.22 + P.load * 0.75) * (0.7 + dark * 0.8) * glow * 0.6, 0, 2.4);
    coreLight.intensity = (0.5 + P.load * 3.2) * glow * (1 + dark * 0.5);

    /* camera. No tween ever touches it. */
    mx += (fin(S.mouseX) - mx) * 0.07;
    my += (fin(S.mouseY) - my) * 0.07;
    camera.position.set(fin(S.camX) + mx * 0.45, fin(S.camY, 1.4) + my * 0.3, fin(S.camZ, 9));
    camera.lookAt(0, fin(S.ty), 0);
    const fov = fin(S.fov, 30);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

    group.rotation.y = fin(S.rotY) + Math.sin(t * 0.16) * 0.035 * fin(S.idleSpin, 1);
    group.position.set(gx, gy, 0);

    /* THE STUDIO LIGHTS GO OUT — lights, shadow, env and exposure move together,
       and main.js turns the page in the same frame. */
    ambient.intensity = 0.45 - dark * 0.36;
    key.intensity = fin(S.keyInt, 2.6) * (1 - dark * 0.62);
    boxL.intensity = 3.4 * (1 - dark * 0.45);
    boxR.intensity = 2.2 * (1 - dark * 0.55);
    rim.intensity = dark * 4.0;
    scene.environmentIntensity = fin(S.envInt, 0.9) * (1 - dark * 0.62);
    ground.material.opacity = clamp(fin(S.shadowOp, 0.3) * (1 - dark * 0.8), 0, 1);
    renderer.toneMappingExposure = fin(S.expo, 1);

    bgCol.copy(LIGHT_BG).lerp(DARK_BG, dark);

    projectRouter(gx, gy);
    renderer.render(scene, camera);
    return bgCol;
  }

  focusEngine(0);

  return { render, focusEngine, scene, camera, renderer, group, parts, mats, links, packets };
}
