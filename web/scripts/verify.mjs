/* The behavioural gate — the things a screenshot cannot tell you.
 * Adopted from the `director` worker's own harness; folded into one file.
 *
 *   npm run build && npm run preview -- --port 4187 --strictPort   (terminal A)
 *   node scripts/verify.mjs http://localhost:4187                  (terminal B)
 *
 * Section 1 runs HEADED, on a real GPU — that is the only way the fps number means
 * anything (SwiftShader would report the speed of a software rasterizer). Sections 2
 * and 3 run headless, where only correctness is being asserted.
 */

import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:4173';
const SW = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const fail = [];
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fail.push(m); };

/* ── 1. MOTION: fps, the tunnel, the marquee, the cursor ─────────────────── */
console.log('\nMOTION (real GPU, 1600×900)');
const b = await chromium.launch({ headless: false });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(`${m.text()} @ ${m.location()?.url}`));
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ready === true);
await p.waitForTimeout(2000);

const max = await p.evaluate(() => document.body.scrollHeight - innerHeight);
const fps = [];
for (let i = 1; i <= 14; i++) {
  await p.evaluate((y) => window.__lenis.scrollTo(y, { duration: 0.9 }), (max * i) / 14);
  await p.waitForTimeout(950);
  fps.push(Number(await p.$eval('#hud-fps', (e) => e.textContent.replace(' fps', ''))));
}
fps.sort((a, c) => a - c);
const median = fps[fps.length >> 1];
console.log(`  fps across the scroll: min ${fps[0]}  median ${median}  max ${fps.at(-1)}`);
ok(median >= 58, `60 fps (median ${median})`);

/* THE TUNNEL IS A SIMULATION, NOT A LOOP. The claim on the page is "your scroll is
   the traffic" — so prove it: park in the tunnel, read the load at rest, drive a
   scroll burst, and assert the load RINGS UP and then SETTLES on its own. A looping
   animation would show no difference between the two. */
/* TWO WAYS THIS MEASUREMENT LIES — it got BOTH wrong on the first attempt, failed the
   assertion, and very nearly sent the scene worker off to "fix" a simulation that was
   already correct. Worth writing down:

   1. Scrolling in ONE direction walks the page OUT of the tunnel act, which drops `flow`
      and takes the core's load down with it. So a hard scroll looked like it barely moved
      the core — the harness was blaming the simulation for what the harness itself was
      doing. Oscillate instead: the wheel keeps |velocity| high while the page stays put
      inside the act.
   2. The load PEAKS ~300ms AFTER the input stops — packets already on the wire keep
      arriving and kicking the spring, which is exactly what a real queue does — and then
      UNDERSHOOTS below rest, because it is underdamped. A single late sample can therefore
      land anywhere on that curve. Sample continuously and take the PEAK.

   And rest is deliberately non-zero: at flow = 1 the tunnel carries baseline traffic even
   while the visitor sits still reading. Zero SCROLL is not zero traffic; zero FLOW is
   (the hero measures load 0.00, 0 packets). So the assertion is about the SURGE. */
const tunnelY = await p.evaluate(() => window.__shots().find((s) => s.name === 'tunnel').y);
const park = async () => {
  await p.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true }), tunnelY);
  await p.waitForTimeout(2600);
};
await park();
const rest = await p.evaluate(() => window.__flow());

let peak = { load: 0, packets: 0, vel: 0 }, trough = Infinity;
const sample = async () => {
  const f = await p.evaluate(() => window.__flow());
  if (f.load > peak.load) peak = f;
  return f;
};
for (let i = 0; i < 14; i++) {                  // oscillate: fast wheel, page stays in the act
  await p.mouse.wheel(0, i % 2 ? -260 : 260);
  await p.waitForTimeout(55);
  await sample();
}
/* Hands off, and watch it ALL the way down. This window has to be long enough: the load
   keeps climbing for ~300ms after the input stops, and the undershoot doesn't arrive until
   ~1.2s. Sampling for less than that misses the dip and libels the spring. */
for (let i = 0; i < 30; i++) {
  await p.waitForTimeout(90);                   // ~2.7s of ring-down
  trough = Math.min(trough, (await sample()).load);
}
await park();
const settled = await p.evaluate(() => window.__flow());

console.log(`  core load: rest ${rest.load.toFixed(2)} → peak ${peak.load.toFixed(2)} → settled ${settled.load.toFixed(2)}  (ring-down trough ${trough.toFixed(2)})`);
ok(peak.load > rest.load * 1.4, `the scroll IS the traffic (peak is ${(peak.load / rest.load).toFixed(2)}× rest)`);
ok(settled.load < peak.load * 0.8, 'the load settles on its own (does not latch high)');
/* A damped lerp can only approach rest from ONE side. Dipping BELOW rest on the way down
   is the signature of a genuinely underdamped spring — this is what "not a loop" means,
   and it is the single assertion that separates this page from a video. */
ok(trough < rest.load, `underdamped: it undershoots rest on the ring-down (${trough.toFixed(2)} < ${rest.load.toFixed(2)})`);
ok(rest.packets > 0 && peak.packets > 0,
  `traffic at rest AND under load (${rest.packets} → ${peak.packets} packets)`);
ok([rest, peak, settled].every((f) => Number.isFinite(f.load) && Number.isFinite(f.vel)),
  'the simulation never latched a NaN');

/* the marquee must REACT to scroll velocity, not loop at a constant rate */
const mx = () => p.$eval('#marquee', (e) => new DOMMatrix(getComputedStyle(e).transform).m41);
await p.evaluate(() => window.__lenis.scrollTo(document.body.scrollHeight, { immediate: true }));
await p.waitForTimeout(600);
const a0 = await mx(); await p.waitForTimeout(700); const a1 = await mx();
const idle = Math.abs(a1 - a0);
const b0 = await mx();
for (let i = 0; i < 7; i++) { await p.mouse.wheel(0, -260); await p.waitForTimeout(100); }
const moving = Math.abs((await mx()) - b0);
console.log(`  marquee drift: idle ${idle.toFixed(1)}px/700ms · scrolling ${moving.toFixed(1)}px/700ms`);
ok(moving > idle * 1.4, 'marquee timeScale follows |scroll velocity|');

await p.mouse.move(400, 300); await p.waitForTimeout(400);
const c1 = await p.$eval('#cursor', (e) => new DOMMatrix(getComputedStyle(e).transform).m41);
await p.mouse.move(1100, 700); await p.waitForTimeout(500);
const c2 = await p.$eval('#cursor', (e) => new DOMMatrix(getComputedStyle(e).transform).m41);
ok(c2 - c1 > 500, `custom cursor follows the pointer (${Math.round(c1)} → ${Math.round(c2)})`);

/* magnetic: hover INSIDE the shape — a swatch is border-radius:50%, so its bounding-box
   corner sits outside the circle and hit-tests as a mouseleave (which correctly springs
   the magnet back to 0). */
const engY = await p.evaluate(() => window.__shots().find((s) => s.name === 'engines').y);
await p.evaluate((y) => window.__lenis.scrollTo(y, { immediate: true }), engY);
await p.waitForTimeout(900);
const magnetic = async (sel, dx, dy) => {
  const box = await (await p.$(sel)).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(150);
  await p.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
  await p.waitForTimeout(600);
  return p.$eval(sel, (e) => {
    const m = new DOMMatrix(getComputedStyle(e).transform);
    return Math.hypot(m.m41, m.m42);
  });
};
ok((await magnetic('#act-engines .sw', 8, 8)) > 1.5, 'magnetic: engine swatch');
ok((await magnetic('.hud__nav a[data-magnetic]', 20, 6)) > 1.5, 'magnetic: nav link');

/* the picker repaints the page AND refocuses the rig */
await p.click('#act-engines .sw:nth-child(3)');
await p.waitForTimeout(800);
const picked = await p.evaluate(() => ({
  name: document.getElementById('engine-name').textContent,
  accent: document.documentElement.style.getPropertyValue('--accent').trim().toUpperCase(),
  focus: window.__flow().focus,
}));
ok(picked.name === 'OpenCode' && picked.accent === '#6D28D9' && picked.focus === 2,
  `the picker repaints the page and refocuses the rig (${JSON.stringify(picked)})`);

ok(Object.keys(await p.evaluate(() => window.__triggers ?? {})).length === 5, '5 pinned acts anchor the poses');
ok(errs.length === 0, `0 console errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
await b.close();

/* ── 2. REDUCED MOTION ──────────────────────────────────────────────────── */
console.log('\nprefers-reduced-motion: reduce');
const b2 = await chromium.launch({ args: SW });
const p2 = await b2.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
const errs2 = [];
p2.on('console', (m) => m.type() === 'error' && errs2.push(m.text()));
p2.on('pageerror', (e) => errs2.push(String(e)));
await p2.goto(URL, { waitUntil: 'networkidle' });
await p2.waitForFunction(() => window.__ready === true);
await p2.waitForTimeout(1500);

ok(await p2.evaluate(() => !window.__lenis), 'no Lenis');
ok(await p2.evaluate(() => !window.__triggers), 'no pins / no scrubs');
ok(await p2.evaluate(() => [...document.querySelectorAll('[data-split] .wi')]
  .every((e) => { const t = getComputedStyle(e).transform; return t === 'none' || new DOMMatrix(t).m42 === 0; })),
  'all text visible (no words parked off-screen)');
ok(await p2.evaluate(() => getComputedStyle(document.getElementById('cursor')).display === 'none'), 'no custom cursor');

await p2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p2.waitForTimeout(900);
const parked = await p2.evaluate(() => {
  const s = window.__S;
  return { camZ: +s.camZ.toFixed(2), groupX: +s.groupX.toFixed(2), dark: +s.dark.toFixed(2),
           finite: Object.values(s).every((v) => Number.isFinite(v)) };
});
ok(parked.dark === 0 && parked.finite,
  `scene parked in the hero pose at the page bottom (${JSON.stringify(parked)})`);

await p2.click('#act-engines .sw:nth-child(2)');
await p2.waitForTimeout(300);
const picked2 = await p2.evaluate(() => document.getElementById('engine-name').textContent);
ok(picked2 === 'Codex', `the engine picker still works (${picked2})`);
ok(errs2.length === 0, `0 console errors${errs2.length ? ': ' + errs2.join(' | ') : ''}`);
await b2.close();

/* ── 3. RESIZE ROUND-TRIP ───────────────────────────────────────────────────
   Crossing the 900px breakpoint tears every pin down (matchMedia reverts them).
   The poses must re-anchor, and the hero must not re-hide itself waiting for a
   play() that already fired. */
console.log('\nRESIZE round-trip (1600 → 800 → 1600)');
const b3 = await chromium.launch({ args: SW });
const p3 = await b3.newPage({ viewport: { width: 1600, height: 900 } });
const errs3 = [];
p3.on('console', (m) => m.type() === 'error' && errs3.push(m.text()));
p3.on('pageerror', (e) => errs3.push(String(e)));
await p3.goto(URL, { waitUntil: 'networkidle' });
await p3.waitForFunction(() => window.__ready === true);
await p3.waitForTimeout(2000);

const state = () => p3.evaluate(() => ({
  pins: Object.keys(window.__triggers ?? {}).length,
  shots: window.__shots().map((s) => s.y),
  heroHidden: [...document.querySelectorAll('.hero [data-split] .wi')]
    .some((e) => Math.abs(new DOMMatrix(getComputedStyle(e).transform).m42) > 1),
  finite: Object.values(window.__S).every((v) => Number.isFinite(v)),
}));
await p3.setViewportSize({ width: 800, height: 900 });
await p3.waitForTimeout(1500);
const mob = await state();
ok(mob.pins === 0, `no pins below 900px (${mob.pins})`);
await p3.setViewportSize({ width: 1600, height: 900 });
await p3.waitForTimeout(1500);
const back = await state();

ok(back.pins === 5, `pins rebuilt (${back.pins})`);
ok(back.shots.every((y, i) => i === 0 || y > back.shots[i - 1]), 'act anchors re-derived, still in scroll order');
ok(!back.heroHidden, 'hero copy still visible after the round trip');
ok(back.finite, 'S is finite (no NaN latched)');
ok(errs3.length === 0, `0 console errors${errs3.length ? ': ' + errs3.join(' | ') : ''}`);
await b3.close();

console.log(fail.length ? `\n✗ ${fail.length} FAILED\n` : '\n✓ all checks passed\n');
process.exit(fail.length ? 1 : 0);
