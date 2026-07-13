/* ══════════════════════════════════════════════════════════════
   main.js — Owned by: `director` worker.

   The router wrote the SKELETON: it is the architecture of
   CONTRACT.md expressed in code, and it is the part that must not
   be violated by accident.

     Lenis → gsap.ticker (ONE RAF) → poseFromScroll(S) → scene

   S is DERIVED from scroll. One writer, once per frame. No tween
   ever touches the camera. Keep it that way.

   director: everything under §7 is yours — pins, reveals, cursor,
   marquee, magnetic, matchMedia. Tune the POSE numbers against the
   real model. Extend freely; do not break the single-writer rule.
   ══════════════════════════════════════════════════════════════ */

import './styles.css';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { initScene, S, ENGINES, SCREEN } from './scene.js';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(hover: none)').matches;

/* ─── 1. Scene + preloader ──────────────────────────────────── */

const countEl = document.getElementById('count');
const barEl = document.getElementById('preloader-bar');
const load = { v: 0 };
const paint = (n) => {
  countEl.textContent = String(Math.round(n)).padStart(2, '0');
  gsap.set(barEl, { scaleX: n / 100 });
};

let viewer;
try {
  viewer = await initScene({
    canvas: document.getElementById('gl'),
    onProgress: (p) => gsap.to(load, { v: p * 100, duration: 0.4, onUpdate: () => paint(load.v) }),
  });
} catch (err) {
  console.error('3D unavailable', err);
  document.getElementById('preloader')?.remove();
}

/* ─── 2. Theme: the page turns with the studio ──────────────── */

const THEME = {
  light: { bg: '#F2F1ED', fg: '#111315', muted: '#7C8288', lineOn: '17,19,21' },
  dark: { bg: '#0E0F11', fg: '#F2F1ED', muted: '#7E858C', lineOn: '242,241,237' },
};
const cA = new THREE.Color(), cB = new THREE.Color(), cOut = new THREE.Color();
const root = document.documentElement;

function applyTheme(d) {
  const set = (name, from, to) => {
    cA.set(from); cB.set(to);
    root.style.setProperty(name, '#' + cOut.copy(cA).lerp(cB, d).getHexString());
  };
  set('--bg', THEME.light.bg, THEME.dark.bg);
  set('--fg', THEME.light.fg, THEME.dark.fg);
  set('--muted', THEME.light.muted, THEME.dark.muted);
  const l = d < 0.5 ? THEME.light.lineOn : THEME.dark.lineOn;
  root.style.setProperty('--line', `rgba(${l}, ${0.14 + d * 0.04})`);
}

/* ─── 3. Lenis + the single ticker ──────────────────────────── */

let lenis = null;
if (!REDUCED) {
  lenis = new Lenis({ duration: 1.2, smoothWheel: true, syncTouch: false });
  lenis.on('scroll', ScrollTrigger.update);
  lenis.on('scroll', ({ velocity }) => { S.scrollVel = velocity; });  // the scroll IS the traffic
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  window.__lenis = lenis;
}

const fpsEl = document.getElementById('hud-fps');
const stageEl = document.getElementById('stage');
let frames = 0, last = performance.now();

if (viewer) {
  gsap.ticker.add((time) => {
    poseFromScroll(lenis ? lenis.scroll : window.scrollY);   // the ONLY writer of S's pose
    applyTheme(S.dark);
    viewer.render(time);

    root.style.setProperty('--router-x', `${SCREEN.x}px`);
    root.style.setProperty('--router-y', `${SCREEN.y}px`);
    root.style.setProperty('--router-d', `${SCREEN.d}px`);
    stageEl.style.opacity = S.stageOp;

    if (++frames >= 30) {
      const now = performance.now();
      fpsEl.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
      frames = 0; last = now;
    }
  });
}

if (!COARSE && !REDUCED) {
  addEventListener('mousemove', (e) => {
    S.mouseX = (e.clientX / innerWidth - 0.5) * 2;
    S.mouseY = -(e.clientY / innerHeight - 0.5) * 2;
  });
}

/* ─── 4. POSE — the choreography. Frozen NAMES, tunable NUMBERS ──
   Framing = 2·d·tan(fov/2). The rig is 3 units across, centred on
   the router. groupX > 0 → product on the right (text left);
   groupX < 0 → the flipped acts (.act--flip).
   ──────────────────────────────────────────────────────────── */

const POSE = {
  hero:      { rotY: -0.45, camX: 0, camY: 1.30, camZ: 9.0, ty: 0.05, fov: 30, groupX: 0.95, groupY: 0, orbit: 0.15, wire: 0,    flow: 0,    xray: 0,    split: 0, dark: 0,    stageOp: 1,   shadowOp: 0.30, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.0, idleSpin: 1.0 },
  // engines: close on the three shells — the picker lives here
  engines:   { rotY: 0.10,  camX: 0, camY: 0.85, camZ: 7.2, ty: 0.00, fov: 26, groupX: 0.85, groupY: 0, orbit: 0.45, wire: 0.1,  flow: 0,    xray: 0,    split: 0, dark: 0,    stageOp: 1,   shadowOp: 0.26, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.1, idleSpin: 0.3 },
  // orbit: the studio lights go OUT. The page turns with them.
  orbit:     { rotY: -0.90, camX: 0, camY: 2.10, camZ: 8.0, ty: 0.10, fov: 28, groupX: -1.0, groupY: 0, orbit: 1.0,  wire: 0.5,  flow: 0.2,  xray: 0,    split: 0, dark: 1,    stageOp: 0,   shadowOp: 0.18, keyInt: 2.6, envInt: 0.90, expo: 1.08, glow: 1.6, idleSpin: 0.5 },
  // tunnel: ghost the shells so the packets read. dark stays LOW on
  // purpose — a mid theme lerp is grey-on-grey and the copy dies.
  tunnel:    { rotY: -0.35, camX: 0, camY: 1.10, camZ: 6.6, ty: 0.00, fov: 32, groupX: 1.05, groupY: 0, orbit: 1.0,  wire: 1.0,  flow: 1.0,  xray: 1,    split: 0, dark: 0.05, stageOp: 1,   shadowOp: 0.14, keyInt: 2.6, envInt: 0.90, expo: 1.02, glow: 2.0, idleSpin: 0.35 },
  worktrees: { rotY: -0.70, camX: 0, camY: 1.80, camZ: 10.4, ty: 0.10, fov: 30, groupX: -1.3, groupY: 0, orbit: 0.6, wire: 0.35, flow: 0.25, xray: 0.2, split: 1, dark: 0.06, stageOp: 1,   shadowOp: 0.28, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.2, idleSpin: 0.5 },
  specs:     { rotY: -3.60, camX: 0, camY: 1.30, camZ: 11.4, ty: 0.00, fov: 32, groupX: -0.1, groupY: 0, orbit: 0.9, wire: 0.7,  flow: 0.45, xray: 0,    split: 0, dark: 0,    stageOp: 0.5, shadowOp: 0.22, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.2, idleSpin: 0.7 },
  outro:     { rotY: -6.40, camX: 0, camY: 1.40, camZ: 9.8, ty: 0.05, fov: 30, groupX: 1.5,  groupY: 0, orbit: 1.0,  wire: 1.0,  flow: 0.6,  xray: 0,    split: 0, dark: 0,    stageOp: 1,   shadowOp: 0.30, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.4, idleSpin: 1.0 },
};

/* PROPS is derived from the table on purpose: scrollVel / mouseX / mouseY
   live on S but NOT in POSE — they are live inputs. If they were in here
   they'd be lerped back to zero every single frame. */
const PROPS = Object.keys(POSE.hero);

let KEYS = [];

/** Anchor each pose to a real scroll position.
    director: pass the ScrollTriggers of your pins once they exist —
    `{ engines: tl1.scrollTrigger, orbit: tl2.scrollTrigger, ... }`.
    Until then this falls back to raw section offsets so the page runs. */
function buildKeys(triggers = null) {
  const at = (sel, tr) => (tr ? tr.end : (document.querySelector(sel)?.offsetTop ?? 0));
  KEYS = [
    { name: 'hero', y: 0, pose: POSE.hero },
    { name: 'engines', y: at('#act-engines', triggers?.engines), pose: POSE.engines },
    { name: 'orbit', y: at('#act-orbit', triggers?.orbit), pose: POSE.orbit },
    { name: 'tunnel', y: at('#act-tunnel', triggers?.tunnel), pose: POSE.tunnel },
    { name: 'worktrees', y: at('#act-worktrees', triggers?.worktrees), pose: POSE.worktrees },
    { name: 'specs', y: at('#specs', triggers?.specs), pose: POSE.specs },
    { name: 'outro', y: ScrollTrigger.maxScroll(window), pose: POSE.outro },
  ].sort((a, b) => a.y - b.y);

  // the screenshot harness asks the page where each act actually lands
  window.__shots = () => KEYS.map(({ name, y }) => ({ name, y }));
}
buildKeys();
ScrollTrigger.addEventListener('refresh', () => buildKeys(window.__triggers));

const smoothstep = (t) => t * t * (3 - 2 * t);

/** The ONE function that writes S's pose. Don't add a second one. */
function poseFromScroll(y) {
  if (KEYS.length < 2 || !Number.isFinite(y)) return;   // Lenis can hand back NaN for a tick after a jump
  let i = 0;
  while (i < KEYS.length - 2 && y > KEYS[i + 1].y) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smoothstep(gsap.utils.clamp(0, 1, (y - a.y) / Math.max(b.y - a.y, 1)));
  for (const p of PROPS) S[p] = a.pose[p] + (b.pose[p] - a.pose[p]) * t;
}

/* ─── 5. Text splitter ──────────────────────────────────────── */

function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.innerHTML = words.map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ');
  return el.querySelectorAll('.wi');
}
document.querySelectorAll('[data-split]').forEach((el) => {
  el._words = splitWords(el);
  gsap.set(el._words, { yPercent: REDUCED ? 0 : 118 });
});

/* ─── 6. The engine picker — picking an engine REPAINTS the page ── */

const enginesEl = document.getElementById('engines');
const nameEl = document.getElementById('engine-name');
const noteEl = document.getElementById('engine-note');

ENGINES.forEach((e, i) => {
  const b = document.createElement('button');
  b.className = 'sw';
  b.type = 'button';
  b.style.setProperty('--sw', e.hex);
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', e.name);
  b.setAttribute('aria-checked', String(i === 0));
  b.addEventListener('click', () => pickEngine(i));
  enginesEl.appendChild(b);
});

function pickEngine(i, animate = true) {
  const e = ENGINES[i];
  viewer?.focusEngine(i);
  nameEl.textContent = e.name;
  noteEl.textContent = e.note;
  [...enginesEl.children].forEach((el, j) => el.setAttribute('aria-checked', String(j === i)));

  if (!animate) {
    root.style.setProperty('--accent', e.accent);
    root.style.setProperty('--stage', e.stage);
    return;
  }
  const p = { t: 0 };
  const aFrom = new THREE.Color((root.style.getPropertyValue('--accent') || ENGINES[0].accent).trim());
  const sFrom = new THREE.Color((root.style.getPropertyValue('--stage') || ENGINES[0].stage).trim());
  const aTo = new THREE.Color(e.accent), sTo = new THREE.Color(e.stage);
  const tA = new THREE.Color(), tS = new THREE.Color();
  gsap.to(p, {
    t: 1, duration: 0.55, ease: 'power2.inOut', overwrite: true,
    onUpdate: () => {
      root.style.setProperty('--accent', '#' + tA.copy(aFrom).lerp(aTo, p.t).getHexString());
      root.style.setProperty('--stage', '#' + tS.copy(sFrom).lerp(sTo, p.t).getHexString());
    },
  });
  gsap.fromTo(nameEl, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' });
}
pickEngine(0, false);

/* ─── 7. DIRECTOR: pins, reveals, cursor, marquee, magnetic ─────
   Everything below is yours. Build the pinned acts with
   gsap.matchMedia(), stash the ScrollTriggers on window.__triggers
   and call buildKeys(window.__triggers) so the poses anchor to the
   real pin positions.
   ──────────────────────────────────────────────────────────── */

/* ─── 8. Preloader out ──────────────────────────────────────── */

gsap.timeline({ onComplete: () => { ScrollTrigger.refresh(); window.__heroIn?.play(); } })
  .to(load, { v: 100, duration: 0.5, ease: 'power2.out', onUpdate: () => paint(load.v) })
  .to('#preloader', {
    opacity: 0, duration: 0.9, ease: 'power2.inOut',
    onComplete: () => document.getElementById('preloader')?.remove(),
  }, '+=0.15');

document.getElementById('btn-top')?.addEventListener('click', (ev) => {
  ev.preventDefault();
  lenis ? lenis.scrollTo(0, { duration: 2 }) : scrollTo(0, 0);
});
document.querySelectorAll('.hud__nav a').forEach((a) => {
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const t = a.getAttribute('href');
    lenis ? lenis.scrollTo(t, { duration: 1.7 }) : document.querySelector(t)?.scrollIntoView();
  });
});

window.__S = S;        // the harness checks S never latched a NaN (CONTRACT.md §7)
window.__ready = true;
