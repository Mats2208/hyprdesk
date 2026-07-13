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

/* Solved against the REAL rig, and against EVERY PHASE OF IT — not a lucky snapshot.

   Two things the nominal "3 units across" hides:

   1. The rig breathes with the story. scene.js sizes the ring as
      `rad = r·(1 + (1−orbit)·0.55) + split·1.5`, and `orbit: 0` means the engines are
      DORMANT, FAR OUT. So the rig is widest exactly where the copy is loudest — the
      hero (orbit 0.15) and worktrees (split 1, engines thrown onto their branches).

   2. The engines NEVER STOP ORBITING: `phase += dt · 0.12 · orbit`. A full revolution
      at orbit 0.55 takes ~95 seconds, so any single measurement — or screenshot — samples
      one arbitrary phase and proves nothing. Tuned on one phase, six of the seven acts
      cropped an engine at some other phase, worst of them by 153px. What the frame has to
      hold is the WORST CASE over the whole ring.

   So each act is solved against the phase-swept footprint: every engine walked right
   around its own ring, worst |x| taken. Half-widths, world units:

       hero 2.57 · engines 2.35 · orbit 1.84 · tunnel 1.98 · worktrees 3.19 · outro 1.97

   and then framed to sit inside its OWN column with air on both sides:

       visW = 2 · camZ · tan(fov/2) · aspect      (aspect 1.6 = the tight case)
       rig ≤ 44% of viewport width, centred on the product column

   The camera sits far back because the object is genuinely big, not because the shot is
   timid — 44% of the viewport is the same apparent size in every act. Losing a little
   scale beats cropping an engine.

   groupX sign follows the REAL rendered layout: product right, except the two
   .act--flip acts (#act-orbit, #act-worktrees) where it goes left. Get the sign wrong
   and the 3D parks on top of its own copy.

   rotY only ever decreases: the rig never rewinds, it keeps turning one way. */
const POSE = {
  // hero: the widest rig of all seven — the engines are dormant and thrown far out
  hero:      { rotY: -0.45, camX: 0, camY: 3.00, camZ: 13.6, ty: 0, fov: 30, groupX: 2.83,   groupY: 0, orbit: 0.15, wire: 0,    flow: 0,    xray: 0,   split: 0, dark: 0,    stageOp: 1,   shadowOp: 0.30, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.0, idleSpin: 1.00 },
  // engines: long lens on the three shells — the picker lives here
  engines:   { rotY: -1.15, camX: 0, camY: 3.45, camZ: 15.0, ty: 0, fov: 25, groupX: 2.59,   groupY: 0, orbit: 0.45, wire: 0.10, flow: 0.05, xray: 0,   split: 0, dark: 0,    stageOp: 1,   shadowOp: 0.26, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.1, idleSpin: 0.35 },
  // orbit: FLIPPED (product left). Camera climbs to 23° so the ring READS as an orbit,
  // and the studio lights go OUT. The page turns with them.
  orbit:     { rotY: -2.10, camX: 0, camY: 4.41, camZ: 10.4,  ty: 0, fov: 28, groupX: -2.03, groupY: 0, orbit: 1.00, wire: 0.50, flow: 0.25, xray: 0,   split: 0, dark: 1,    stageOp: 0,   shadowOp: 0.16, keyInt: 2.6, envInt: 0.90, expo: 1.10, glow: 2.1, idleSpin: 0.55 },
  // tunnel: the page BURNS. dark: 1 — emission and bloom do nothing at #f0efec, so the
  // act that is entirely about light on a wire has to happen in the dark. The halo goes
  // with it (stageOp 0): a pale CSS disc on black is a milky smudge; the light in this
  // act comes from the core and the packets, not from a gradient.
  // (Round 1 held dark at 0.05 because a mid-lerp was grey-on-grey and killed the copy.
  //  That was a symptom. `style` fixed the CAUSE — ink lightness now derives from the
  //  background's own lightness — so the full 0→1 swing is safe. Worst contrast in the
  //  whole transition is 3.92:1. The workaround can go.)
  tunnel:    { rotY: -2.75, camX: 0, camY: 2.19, camZ: 9.8,  ty: 0, fov: 32, groupX: 2.19,   groupY: 0, orbit: 1.00, wire: 1.00, flow: 1.00, xray: 1,   split: 0, dark: 1,    stageOp: 0,   shadowOp: 0.14, keyInt: 2.6, envInt: 0.90, expo: 1.02, glow: 2.6, idleSpin: 0.35 },
  // worktrees: flipped (product left). `split` throws the engines onto their branches —
  // the second-widest rig, so the frame is pulled back to hold the whole explosion.
  worktrees: { rotY: -3.60, camX: 0, camY: 4.00, camZ: 16.9, ty: 0, fov: 30, groupX: -3.52, groupY: 0, orbit: 0.55, wire: 0.35, flow: 0.25, xray: 0.2, split: 1, dark: 0.06, stageOp: 1,   shadowOp: 0.28, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.2, idleSpin: 0.50 },
  // specs: centred turntable behind the cards — a backdrop, so it may be small
  specs:     { rotY: -5.80, camX: 0, camY: 2.00, camZ: 12.6, ty: 0, fov: 32, groupX: 0,     groupY: 0, orbit: 0.90, wire: 0.70, flow: 0.45, xray: 0,   split: 0, dark: 0,    stageOp: 0.5, shadowOp: 0.22, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.2, idleSpin: 0.70 },
  outro:     { rotY: -8.90, camX: 0, camY: 1.88, camZ: 10.4,  ty: 0, fov: 30, groupX: 2.18,   groupY: 0, orbit: 1.00, wire: 1.00, flow: 0.60, xray: 0,   split: 0, dark: 0,    stageOp: 1,   shadowOp: 0.30, keyInt: 2.6, envInt: 0.90, expo: 1.00, glow: 1.4, idleSpin: 1.00 },
};

/* PROPS is derived from the table on purpose: scrollVel / mouseX / mouseY
   live on S but NOT in POSE — they are live inputs. If they were in here
   they'd be lerped back to zero every single frame. */
const PROPS = Object.keys(POSE.hero);

/* An act is anchored to its pin as a HOLD BAND — the same pose at the pin's start AND
   its end — so the whole camera/theme/story move happens in the 100vh gap BETWEEN acts
   and the act itself is read at the framing it was designed for.

   Anchoring on the pin's end alone (the skeleton's first draft) puts every beat on the
   act's last pixel: `flow` only reaches 1.0, `split` only finishes exploding, and `dark`
   only lands, as the copy is already scrolling away. Worse, the theme then lerps through
   grey across the whole tunnel pin — grey text on grey, exactly the trap CONTRACT.md §5
   warns about. The hold fixes all three at once, and it's why the act screenshots are
   worth looking at: they now show the designed frame WITH its copy.

   `specs` deliberately does NOT hold: it has no copy to protect, so the rig turntables
   right through the horizontal pan. */
const ACTS = [
  ['engines', '#act-engines', true],
  ['orbit', '#act-orbit', true],
  ['tunnel', '#act-tunnel', true],
  ['worktrees', '#act-worktrees', true],
  ['specs', '#specs', false],
];

let KEYS = [];
let SHOTS = [];

/** Anchor each pose to a real scroll position. `triggers` are the pins from §7; without
    them (mobile, reduced motion) this falls back to the section tops — which is correct
    precisely because nothing is pinned there, so no pin-spacer has moved anything. */
function buildKeys(triggers = null) {
  const top = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().top + window.scrollY : 0;
  };
  const max = ScrollTrigger.maxScroll(window);

  KEYS = [{ y: 0, pose: POSE.hero }];
  SHOTS = [{ name: 'hero', y: 0 }];

  for (const [name, sel, hold] of ACTS) {
    const tr = triggers?.[name];
    const a = tr ? tr.start : top(sel);
    const b = tr ? tr.end : a;
    if (hold) {
      KEYS.push({ y: a, pose: POSE[name] });
      if (b > a) KEYS.push({ y: b, pose: POSE[name] });
    } else {
      KEYS.push({ y: b, pose: POSE[name] });
    }
    // shoot the act where a visitor reads it: past the reveal, inside the hold
    SHOTS.push({ name, y: a + (b - a) * (hold ? 0.72 : 0.6) });
  }

  // the outro settles as the CTA comes up, not on the last pixel of the document
  const outroY = Math.min(top('.outro__grid') - innerHeight * 0.3, max);
  KEYS.push({ y: outroY, pose: POSE.outro });
  if (max > outroY) KEYS.push({ y: max, pose: POSE.outro });
  SHOTS.push({ name: 'outro', y: max });

  KEYS.sort((a, b) => a.y - b.y);

  // the screenshot harness asks the page where each act actually lands
  window.__shots = () => SHOTS.map(({ name, y }) => ({ name, y: Math.round(y) }));
}
buildKeys();
ScrollTrigger.addEventListener('refresh', () => buildKeys(window.__triggers));

const smoothstep = (t) => t * t * (3 - 2 * t);

/* The grid is two columns, so the binding constraint on framing is WIDTH — and visible
   width scales with the ASPECT RATIO, which the POSE table can't know. Solved at 1.6;
   in a narrower window (a 4:3 desktop, a short browser) the same numbers throw the rig
   off the edge of its own column.

   Dolly the camera back by exactly the deficit and the visible width comes back to the
   design width: W = 2·(k·camZ)·tan(fov/2)·(A₀/k) = W₀. groupX is NOT scaled — the column
   centre is a fraction of W, and W is now W₀ again, so the composition is the one that
   was solved. Only the rig gets smaller, which is the whole point. camY rides along so
   the elevation angle survives. */
const DESIGN_ASPECT = 1.6;
const fit = () => Math.max(1, DESIGN_ASPECT / (innerWidth / innerHeight));

/* Below 900px styles.css collapses the grid to ONE column and hides .col--product —
   there is no product column left for the rig to sit in, so a groupX solved for a
   two-column grid just hangs it half off the right edge, behind the copy. Centre it and
   let it read as a backdrop. Same breakpoint as the CSS, and derived HERE: a media
   listener writing S.groupX would be a second writer, which is the one thing this
   architecture doesn't allow. */
const SOLO = () => innerWidth <= 900;

/** The ONE function that writes S's pose. Don't add a second one. */
function poseFromScroll(y) {
  // reduced motion: the scene is PARKED in the hero pose. Still one writer, still every frame.
  if (REDUCED) {
    for (const p of PROPS) S[p] = POSE.hero[p];
  } else {
    if (KEYS.length < 2 || !Number.isFinite(y)) return;   // Lenis can hand back NaN for a tick after a jump
    let i = 0;
    while (i < KEYS.length - 2 && y > KEYS[i + 1].y) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smoothstep(gsap.utils.clamp(0, 1, (y - a.y) / Math.max(b.y - a.y, 1)));
    for (const p of PROPS) S[p] = a.pose[p] + (b.pose[p] - a.pose[p]) * t;
  }
  // re-derived from POSE every frame, so scaling in place can never accumulate
  const k = fit();
  if (k > 1) { S.camX *= k; S.camY *= k; S.camZ *= k; }
  if (SOLO()) S.groupX = 0;   // one column: the rig centres and becomes the backdrop
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

  if (!animate || REDUCED) {   // the picker still works under reduced motion — it just doesn't move
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
   ScrollTrigger pins the sections and reveals the text. It NEVER
   touches the scene: the pins exist so `buildKeys` can anchor each
   pose to the pin's real end position. That's the only coupling.
   ──────────────────────────────────────────────────────────── */

const mm = gsap.matchMedia();
const MOTION = '(prefers-reduced-motion: no-preference)';

/** Reveal every [data-split] inside a scrubbed act timeline, in DOM order. */
const revealInto = (tl, scope, at = 0.05) =>
  document.querySelectorAll(`${scope} [data-split]`).forEach((el, i) => {
    tl.to(el._words, { yPercent: 0, duration: 0.55, ease: 'power3.out', stagger: 0.025 }, at + i * 0.07);
  });

/** Reveal on enter — for the acts that aren't pinned (mobile) and for the outro. */
const revealOnEnter = (scope) =>
  document.querySelectorAll(`${scope} [data-split]`).forEach((el) => {
    gsap.to(el._words, {
      yPercent: 0, duration: 0.9, ease: 'power4.out', stagger: 0.03,
      scrollTrigger: { trigger: el, start: 'top 90%' },
    });
  });

/* 7a — reduced motion: no scrubs, no pins, all the text visible.
   (Lenis and the cursor never got built; the scene is parked in poseFromScroll.) */
mm.add('(prefers-reduced-motion: reduce)', () => {
  gsap.set('[data-split] .wi', { yPercent: 0 });
  applyTheme(0);   // the ticker paints the theme, but it doesn't run if the scene failed
});

/* 7b — what both motion branches share: hero intro, outro, marquee. */
function motionCommon() {
  const heroIn = gsap.timeline({ paused: true });
  document.querySelectorAll('.hero [data-split]').forEach((el, i) => {
    heroIn.to(el._words, { yPercent: 0, duration: 1.15, ease: 'power4.out', stagger: 0.03 }, i * 0.1);
  });
  heroIn.from('.scrollcue', { opacity: 0, duration: 0.8 }, 0.6);
  window.__heroIn = heroIn;
  // a resize across the breakpoint re-runs this block. If the preloader is already
  // gone the intro has played — don't hide the hero again waiting for a play() that
  // will never come (the preloader timeline fires exactly once).
  if (!document.getElementById('preloader')) heroIn.progress(1);

  gsap.to('.hero__grid', {
    yPercent: -12, opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  revealOnEnter('.outro');
  gsap.from('.price, .outro__cta', {
    opacity: 0, y: 24, duration: 0.9, stagger: 0.12, ease: 'power3.out',
    scrollTrigger: { trigger: '.price', start: 'top 90%' },
  });

  // The marquee is not a constant loop: the scroll drives it. Stop scrolling and
  // it idles; flick the wheel and it snaps forward. Same input as the packet flow.
  const marquee = gsap.to('#marquee', { xPercent: -50, duration: 26, ease: 'none', repeat: -1 });
  const drive = ({ velocity }) =>
    marquee.timeScale(gsap.utils.clamp(0.35, 6, 1 + Math.abs(velocity) * 0.08));
  lenis?.on('scroll', drive);

  return () => lenis?.off('scroll', drive);   // matchMedia reverts tweens, not listeners
}

/* 7c — desktop: the pinned acts. Their ScrollTriggers ARE the pose anchors. */
mm.add(`${MOTION} and (min-width: 901px)`, () => {
  const cleanCommon = motionCommon();

  /* Each act's timeline gets a TAIL of dead time, so the reveals land in the first ~40%
     of the pin and the act then simply sits there — read, still, at its pose. The pose
     holds across the same band (see buildKeys), so the two agree. */
  const act = (sel, len) => gsap.timeline({
    scrollTrigger: { trigger: sel, start: 'top top', end: `+=${len}`, pin: true, scrub: 1, anticipatePin: 1 },
  });
  const hold = (tl) => tl.to({}, { duration: 1.3 });

  const tlE = act('#act-engines', 1600);
  revealInto(tlE, '#act-engines');
  // opacity+scale, NOT y: the swatches are magnetic, and magnetic owns x/y
  tlE.from('#act-engines .sw', { opacity: 0, scale: 0.6, stagger: 0.06, duration: 0.4, ease: 'back.out(2)' }, 0.5);
  hold(tlE);

  const tlO = act('#act-orbit', 1700);
  revealInto(tlO, '#act-orbit');
  tlO.from('#act-orbit .specs li', { opacity: 0, x: 18, stagger: 0.06, duration: 0.4 }, 0.5);
  hold(tlO);

  // the tunnel gets the longest pin: the packet simulation is the act, and it needs
  // room to be watched at full `flow` — which the hold band now actually gives it
  const tlT = act('#act-tunnel', 2200);
  revealInto(tlT, '#act-tunnel');
  tlT.from('#act-tunnel .specs li', { opacity: 0, x: -18, stagger: 0.06, duration: 0.4 }, 0.5);
  hold(tlT);

  const tlW = act('#act-worktrees', 1800);
  revealInto(tlW, '#act-worktrees');
  hold(tlW);

  /* Horizontal specs. The x distance is the REAL overflow (recomputed on refresh), but
     the PIN is longer than it: four 420px cards only overhang a 1600px viewport by
     ~290px, and a 290px act is a blip. Stretching the pin turns the pan into a slow
     deliberate drift instead — and gives the turntable room to turn. */
  const track = document.getElementById('htrack');
  const over = () => Math.max(track.scrollWidth - innerWidth, 1);
  const hx = gsap.to(track, {
    x: () => -over(), ease: 'none',
    scrollTrigger: {
      trigger: '#specs', start: 'top top', end: () => `+=${over() + innerHeight * 0.75}`,
      pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true,
    },
  });
  // containerAnimation: the cards enter as the TRACK passes them, not as the page scrolls
  document.querySelectorAll('.card').forEach((c) => {
    gsap.from(c, {
      opacity: 0, scale: 0.94, duration: 0.5, ease: 'power3.out',
      scrollTrigger: { trigger: c, containerAnimation: hx, start: 'left 88%' },
    });
  });

  // THIS is why the pins exist: the poses anchor to where the acts really land.
  window.__triggers = {
    engines: tlE.scrollTrigger, orbit: tlO.scrollTrigger, tunnel: tlT.scrollTrigger,
    worktrees: tlW.scrollTrigger, specs: hx.scrollTrigger,
  };
  buildKeys(window.__triggers);

  return () => {
    cleanCommon();
    window.__triggers = null;   // the triggers die with the media query; don't anchor to corpses
    buildKeys();
  };
});

/* 7d — mobile: no pins (the product column is hidden anyway), text still reveals.
   buildKeys falls back to offsetTop, which is correct precisely because nothing is pinned. */
mm.add(`${MOTION} and (max-width: 900px)`, () => {
  const cleanCommon = motionCommon();
  revealOnEnter('.act');
  return cleanCommon;
});

/* 7e — the cursor: dot + ring, and everything magnetic pulls them. */
mm.add(`${MOTION} and (hover: hover) and (pointer: fine)`, () => {
  const dot = document.getElementById('cursor');
  const ring = document.getElementById('cursor-ring');
  const ac = new AbortController();
  const { signal } = ac;

  const dx = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power3' });
  const dy = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power3' });
  const rx = gsap.quickTo(ring, 'x', { duration: 0.6, ease: 'power3' });
  const ry = gsap.quickTo(ring, 'y', { duration: 0.6, ease: 'power3' });
  addEventListener('mousemove', (e) => {
    dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY);
  }, { signal });

  document.querySelectorAll('[data-magnetic], .sw').forEach((el) => {
    const mx = gsap.quickTo(el, 'x', { duration: 0.45, ease: 'elastic.out(1, 0.45)' });
    const my = gsap.quickTo(el, 'y', { duration: 0.45, ease: 'elastic.out(1, 0.45)' });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      mx((e.clientX - r.left - r.width / 2) * 0.2);
      my((e.clientY - r.top - r.height / 2) * 0.2);
    }, { signal });
    el.addEventListener('mouseenter', () => {
      gsap.to(ring, { scale: 2.1, opacity: 0.14, duration: 0.35 });
    }, { signal });
    el.addEventListener('mouseleave', () => {
      mx(0); my(0);
      gsap.to(ring, { scale: 1, opacity: 0.3, duration: 0.35 });
    }, { signal });
  });

  return () => ac.abort();   // gsap reverts the tweens; the listeners are ours to remove
});

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
window.__viewer = viewer;  // escape hatch (CONTRACT.md §1): lets a probe project the rig
                           // to screen px and PROVE a frame doesn't crop, instead of eyeballing
window.__ready = true;
