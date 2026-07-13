/* ══════════════════════════════════════════════════════════════
   scene.js — CONTRACT STUB (router). Owned by: `scene` worker.

   This is a placeholder that satisfies CONTRACT.md so `director` and
   `style` can run the page before the real .glb and the real studio
   land. It renders primitives carrying the REAL material names.

   scene worker: replace the body, keep the exports. Delete
   buildPlaceholder() once public/models/hyprdesk.glb exists —
   initScene must then REJECT if the model fails to load (main.js
   already catches it).
   ══════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

/** Engines sit on a ring of radius 2.6, 120° apart, starting at +X. */
export const RING = 2.6;
export const engineAngle = (i) => (i * Math.PI * 2) / 3;

/* ponytail: primitives only — the real geometry is the `models` worker's job.
   The names are what matter: they are the contract. */
function buildPlaceholder() {
  const root = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.62, 1),
    new THREE.MeshPhysicalMaterial({ name: 'RouterCore', color: '#F2F1ED', emissive: '#8FD8FF', emissiveIntensity: 1.2, roughness: 0.25 })
  );
  core.name = 'Router';
  root.add(core);

  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 0),
    new THREE.MeshPhysicalMaterial({ name: 'Cage', color: '#9AA1A8', metalness: 1, roughness: 0.28, wireframe: true })
  );
  cage.name = 'RouterCage';
  root.add(cage);

  ENGINES.forEach((e, i) => {
    const a = engineAngle(i);
    const shell = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 0),
      new THREE.MeshPhysicalMaterial({ name: `Shell${e.name}`, color: e.hex, roughness: e.rough, metalness: 0.1, clearcoat: 0.4 })
    );
    shell.name = e.mesh;
    shell.position.set(Math.cos(a) * RING, 0, Math.sin(a) * RING);
    root.add(shell);
  });

  return root;
}

export async function initScene({ canvas, onProgress }) {
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

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, S.keyInt);
  key.position.set(3.4, 7.5, 5.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: S.shadowOp, transparent: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.8;
  ground.receiveShadow = true;
  scene.add(ground);

  const group = new THREE.Group();
  scene.add(group);

  /* --- Model, with a placeholder fallback while `models` bakes it --- */
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
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    parts[o.name] = o;
    if (o.material?.name) mats[o.material.name] = o.material;   // by material NAME, never by traverse-paint
  });

  // normalize: router bounding sphere → 3 units across
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(3 / Math.max(size.x, size.y, size.z));
  group.add(model);

  function focusEngine(i) {
    ENGINES.forEach((e, j) => {
      const m = mats[`Shell${e.name}`];
      if (!m) return;
      m.emissive?.set(e.hex);
      m.emissiveIntensity = j === i ? 0.35 : 0.0;
    });
  }
  focusEngine(0);

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  const pTop = new THREE.Vector3(), pBot = new THREE.Vector3();
  function projectRouter() {
    pTop.set(S.groupX, 1.5, 0).project(camera);
    pBot.set(S.groupX, -1.5, 0).project(camera);
    const yTop = (1 - (pTop.y * 0.5 + 0.5)) * innerHeight;
    const yBot = (1 - (pBot.y * 0.5 + 0.5)) * innerHeight;
    SCREEN.x = (pTop.x * 0.5 + 0.5) * innerWidth;
    SCREEN.y = (yTop + yBot) / 2;
    // CLAMPED: in the close-ups an unclamped halo swallows the text column.
    SCREEN.d = Math.min(Math.abs(yBot - yTop) * 1.3, innerHeight * 0.95, innerWidth * 0.62);
  }

  let mx = 0, my = 0, prevT = 0;
  const bgCol = new THREE.Color();

  function render(time) {
    const dt = Math.min(Math.max(prevT ? time - prevT : 1 / 60, 1 / 240), 1 / 30);
    prevT = time;

    mx += (S.mouseX - mx) * 0.07;
    my += (S.mouseY - my) * 0.07;

    camera.position.set(S.camX + mx * 0.45, S.camY + my * 0.3, S.camZ);
    camera.lookAt(0, S.ty, 0);
    if (camera.fov !== S.fov) { camera.fov = S.fov; camera.updateProjectionMatrix(); }

    group.rotation.y = S.rotY + Math.sin(time * 0.16) * 0.035 * S.idleSpin;
    group.position.set(S.groupX, S.groupY, 0);

    ambient.intensity = 0.45 - S.dark * 0.36;
    key.intensity = S.keyInt * (1 - S.dark * 0.55);
    scene.environmentIntensity = S.envInt * (1 - S.dark * 0.62);
    ground.material.opacity = S.shadowOp * (1 - S.dark * 0.75);
    renderer.toneMappingExposure = S.expo;

    bgCol.copy(LIGHT_BG).lerp(DARK_BG, S.dark);

    projectRouter();
    renderer.render(scene, camera);
    return bgCol;
  }

  return { render, focusEngine, scene, camera, renderer, group, parts, mats };
}
