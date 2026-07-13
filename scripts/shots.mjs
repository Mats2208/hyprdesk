/* Screenshot harness — the definition of done. Owned by: router.
 *
 *   npm run build && npm run preview       (terminal A)
 *   npm run shots                          (terminal B)
 *
 * Headless Chromium with a REAL WebGL context (SwiftShader), one shot per act,
 * driven through Lenis so the page reaches each pose exactly the way a visitor
 * would. Exits non-zero on ANY console error — that's the gate.
 *
 * The low fps in the captures is software rasterization, not the real thing.
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.argv[2] ?? 'http://localhost:4173';
const OUT = '.shots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20_000 });

// the renderer is real: prove it before we trust a single pixel
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  return c ? c.getParameter(c.VERSION) : null;
});
if (!gl) { console.error('✗ no WebGL context — the shots would be blank'); process.exit(1); }
console.log(`WebGL: ${gl}`);

await page.waitForTimeout(1500);   // preloader out

const acts = await page.evaluate(() => window.__shots?.() ?? []);
if (!acts.length) { console.error('✗ window.__shots() is empty — main.js never built its keys'); process.exit(1); }

let i = 0;
for (const act of acts) {
  await page.evaluate((y) => {
    window.__lenis ? window.__lenis.scrollTo(y, { immediate: true }) : window.scrollTo(0, y);
  }, act.y);
  await page.waitForTimeout(900);   // let the sim settle into the pose

  const n = String(++i).padStart(2, '0');
  await page.screenshot({ path: `${OUT}/${n}-${act.name}.png` });
  console.log(`  ${n}-${act.name}.png   @ y=${Math.round(act.y)}`);
}

// the simulation must still be alive after the immediate-jumps (the NaN trap)
const alive = await page.evaluate(() => {
  const s = window.__S;
  return !s || Object.values(s).every((v) => typeof v !== 'number' || Number.isFinite(v));
});

await browser.close();

if (!alive) { console.error('✗ S latched a NaN after the scroll jumps — see CONTRACT.md §7'); process.exit(1); }
if (errors.length) {
  console.error(`\n✗ ${errors.length} console error(s):`);
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log(`\n✓ ${acts.length} shots, 0 console errors`);
