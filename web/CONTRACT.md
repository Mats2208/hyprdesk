# CONTRACT — read this before you write a line

Four workers build this landing page in parallel, one file each. This document is the
interface between you. **It is frozen.** If you need it changed, you ask the router — you
do not change it unilaterally, because three other people are compiling against it.

```
worker    owns
──────────────────────────────────────────────────
models    scripts/*.py           → public/models/hyprdesk.glb
scene     src/scene.js
director  src/main.js
style     src/styles.css  (+ copy tweaks in index.html)
```

`index.html`, `package.json`, `vite.config.js`, `scripts/*`, `CONTRACT.md` and `README.md`
belong to the **router**. Don't edit them (style may adjust copy text inside existing
`index.html` elements — but never rename or remove an `id`, a `class`, a `[data-split]`
or a `[data-magnetic]` hook, because main.js and styles.css both query them).

**`.shots/` is generated, and the router owns it.** Render it locally as often as you like
— you should, it is the only way to see what you actually built — but **do not commit it**.
Three workers committing binary renders of the same seven acts, each shot against their own
branch's stale `main.js`, is a guaranteed add/add conflict on every merge (it has already
cost two manual resolutions) *and* the images are misleading: a screenshot from a branch
that lacks the other three layers is a picture of a page that does not exist. The router
regenerates `.shots/` from integrated master, which is the only tree where the renders mean
anything.

**Ports.** `npm run preview` defaults to 4173 and several are already taken on this machine.
Always pass `--port <n> --strictPort` with a port you picked, and pass the same URL to the
harness. Without `--strictPort` Vite silently walks to the next free port, and without
matching URLs the harness will happily screenshot **someone else's build** and report it
green — the tell is act anchors coming back evenly spaced (the unpinned fallback) instead of
at real pin positions. This has already happened once.

---

## 0. The architecture, in one box

```
Lenis → gsap.ticker (a SINGLE RAF)
          ├─ ScrollTrigger → pins + text reveals   (NEVER touches the 3D scene)
          └─ render loop   → poseFromScroll(y) → S → Three.js
```

**`S` is DERIVED from the scroll position, never animated with tweens.** `poseFromScroll()`
is the one and only writer of the pose props of `S`, once per frame. It interpolates a table
of keyframes anchored to the real pixel position of each pin.

This is not a style preference. Several `scrub` timelines writing the same properties is a
race: the old act's scrub can land *after* the new one and stomp it. Deriving the state makes
it deterministic — **jumping to a scroll position gives exactly the same frame as scrolling
there**, which is also what makes the screenshot harness meaningful.

Hard rules, all four of you:

- **No `gsap.to(camera…)`.** No tween touches the camera, the group, or any pose prop.
- **One RAF.** `gsap.ticker` drives Lenis and the renderer. Don't call
  `requestAnimationFrame` and don't call `renderer.setAnimationLoop`.
- **No React, no framework.** Vanilla ES modules, Vite. Three deps: `three`, `gsap`, `lenis`.
- **Never `traverse(o => o.material = x)`.** Identify meshes by **material name** (below).
  Painting by traverse hits every mesh, including the ones you didn't mean.

---

## 1. `src/scene.js` — the API it MUST export

```js
export const S        // the shared state object (§2)
export const ENGINES  // the three engines (§3)
export const SCREEN   // { x, y, d } — router projected to CSS px (§4)
export async function initScene({ canvas, onProgress }) → viewer
```

`onProgress(p)` is called with `p` in `0..1` while the .glb loads (feeds the preloader).

`initScene` **rejects** if WebGL or the model is unavailable. `main.js` catches it, logs, and
removes the preloader — the page must still read as a page without 3D.

The returned `viewer`:

```js
viewer.render(time)      // time = seconds, from gsap.ticker. Derives dt ITSELF (see §6).
viewer.focusEngine(i)    // 0..2 — the engine picker. Highlights engine i, dims the others.
viewer.scene / .camera / .renderer / .group / .parts   // escape hatches, for debugging
```

## 2. `S` — the exact shape. These names are the contract.

```js
export const S = {
  // ── camera & framing ─────────────────────────────────────────
  rotY: 0,                     // rotation of the whole rig, radians
  camX: 0, camY: 1.4, camZ: 9.0,
  ty: 0,                       // camera lookAt target Y
  fov: 30,
  groupX: 0.95, groupY: 0,     // rig offset — puts the object in the column opposite the text
  // ── the story ────────────────────────────────────────────────
  orbit: 0,      // 0 = engines dormant, far out · 1 = full orbit around the router
  wire: 0,       // 0 = no links · 1 = A2A tunnel fully wired (link opacity + reach)
  flow: 0,       // 0 = no packets · 1 = packets streaming through the links
  xray: 0,       // 0 = shells opaque · 1 = ghost, so the packets read from outside
  split: 0,      // 0 = together · 1 = worktree explosion (engines pull onto their branches)
  // ── the studio ───────────────────────────────────────────────
  dark: 0,       // 0 = lit studio · 1 = lights OFF (the page turns with it)
  stageOp: 1,    // opacity of the CSS halo behind the product
  shadowOp: 0.3, // contact shadow opacity
  keyInt: 2.6, envInt: 0.9, expo: 1.0,
  glow: 1,       // emissive multiplier of the router core
  idleSpin: 1,   // amplitude of the idle breathing rotation
  // ── inputs (written by main.js, NOT by poseFromScroll) ───────
  scrollVel: 0,  // Lenis scroll velocity → feeds the traffic simulation
  mouseX: 0, mouseY: 0,
};
```

> **The split matters.** `poseFromScroll` writes exactly the props listed in the POSE table
> (§5) — the camera/story/studio block. `scrollVel`, `mouseX`, `mouseY` live on `S` but are
> **not** in POSE: they're live inputs, and if they were in the table they'd be lerped to zero
> every frame. `PROPS = Object.keys(POSE.hero)` enforces this — keep it that way.

## 3. `ENGINES` — the picker (and the page repaints with it)

```js
export const ENGINES = [
  { id:'claude',   name:'Claude',   mesh:'EngineClaude',   hex:'#D97757', rough:0.34,
    accent:'#C2410C', stage:'#F6E7DE', note:'Deep reasoning, architecture, cross-cutting code.' },
  { id:'codex',    name:'Codex',    mesh:'EngineCodex',    hex:'#6366F1', rough:0.30,
    accent:'#4338CA', stage:'#E4E5FB', note:'Precise implementation — and real raster image generation.' },
  { id:'opencode', name:'OpenCode', mesh:'EngineOpenCode', hex:'#7C5CFF', rough:0.38,
    accent:'#6D28D9', stage:'#E7E2FB', note:'Third-party models: whatever provider you are authed against.' },
];
```

Picking an engine **repaints the page**: `--accent` and `--stage` are driven from the active
engine (director owns that wiring; style owns what those tokens do).

## 4. `SCREEN` — the halo follows the router

`scene.js` projects the router core to CSS pixels every frame and writes `SCREEN.{x,y,d}`.
`main.js` copies them to `--router-x`, `--router-y`, `--router-d`. `styles.css` uses them to
place `#stage`. **Clamp `d`** — in the close-up acts the projection explodes and an unclamped
halo swallows the text column (the reference project shipped that bug once).

## 5. `POSE` — the act names are frozen

Seven keyframes, one per section, in scroll order. Every act carries **every** prop in the
camera/story/studio block — a missing key lerps to `undefined` → `NaN` → a dead frame.

```
hero · engines · orbit · tunnel · worktrees · specs · outro
```

They are anchored to the real pin positions at runtime, so **the numbers below are the
starting draft, not gospel** — director tunes them against the real model. `POSE` lives in
`main.js` and director owns it.

Section ids in `index.html` (frozen): `.hero`, `#act-engines`, `#act-orbit`, `#act-tunnel`,
`#act-worktrees`, `#specs`, `.outro`.

## 6. The model — `public/models/hyprdesk.glb`

**One file.** Draco-compressed, **under 150 KB**, reproducible from `scripts/*.py` via
Blender 5.1 (installed at `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`).

Mesh names and material names are the contract between `models` and `scene`:

| mesh | material | what it is |
|---|---|---|
| `Router` | `RouterCore` | the core. Emissive — it glows under load. |
| `RouterCage` | `Cage` | the faceted shell around the core. Metal. |
| `EngineClaude` | `ShellClaude` | engine body |
| `EngineCodex` | `ShellCodex` | engine body |
| `EngineOpenCode` | `ShellOpenCode` | engine body |
| `GlyphClaude` / `GlyphCodex` / `GlyphOpenCode` | `Glyph` (shared) | the engine mark, **engraved as real geometry** |

**Three separate shell materials, not one shared instance** — the picker tints the active
engine independently. `Glyph` is deliberately shared: it's one emissive material for all three.

**No textures, no UV maps, no image files.** The marks are geometry (engraved/extruded), not
decals. That is a deliberate call: it deletes the entire UV / `flipY` / `polygonOffset` /
z-fighting class of bugs that cost the reference projects real time, and it survives a close-up
better than a projected decal. If you think you need a texture, come back to the router first.

**Orientation & scale.** +Y up, -Z forward. Router centred on the origin. The rig is normalized
by `scene.js` to **3 units** across the router's bounding sphere; engines authored on a ring of
radius **≈ 2.6** in the XZ plane at 120° apart, starting at +X. Apply all transforms before
export (no baked-in object scale).

Links/packets are **procedural in `scene.js`** — do not model them. They must react to scroll.

## 7. The simulation — `flow` is not a video

The tunnel act has to be a real simulation, not a looping animation:

- Packets travel router ↔ engine along the links. Rate is driven by `S.flow` **and by
  `|S.scrollVel|`** — *the scroll is the traffic*. Inside an act the rig barely moves, so
  without the velocity term the tunnel would sit still exactly while the visitor is reading
  about it.
- The core's load is a **spring–damper**, underdamped (ζ ≈ 0.3): it flares on a burst and
  settles on its own. The glow is the load, not a `sin()`.

**A simulation accumulates state, so it can latch NaN forever.** One bad frame poisons it
permanently — and the bad frame *will* arrive: after `scrollTo({immediate:true})` Lenis can
return a `NaN` scroll for one tick, `poseFromScroll` writes it into all of `S`, and the
integrator latches it. It fails **silently** — no console error, the sim just quietly stops.
So: sanitize the inputs **and** let the state heal itself.

```js
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
if (![P.load, P.vel].every(Number.isFinite)) { P.load = P.vel = 0; }
```

Same reason `render(time)` derives `dt` from its own `time` argument and clamps it —
depending on the ticker's second argument is fragile, and a backgrounded tab hands you a
multi-second `dt` that detonates the integrator:

```js
const dt = Math.min(Math.max(prevT ? time - prevT : 1/60, 1/240), 1/30);
```

## 8. CSS traps that already cost us

```css
.act__title span   { display: block; }  /* ✗ */
.act__title > span { display: block; }  /* ✓ */
```

The text splitter injects `<span class="w">` per word. A **descendant** selector matches those
too, with higher specificity than `.w` — you get one word per line, and the long ones clipped
by `.w { overflow: hidden }`. This has bitten three projects in a row. Use the child combinator.

## 9. Definition of done (all four of you are measured on this)

- Zero console errors. `window.__ready === true`.
- 60 fps with the FPS HUD visible (`#hud-fps`).
- `prefers-reduced-motion`: no Lenis, no scrubs, no custom cursor, all text visible, scene
  parked in the hero pose. The engine picker still works.
- `npm run shots` produces `.shots/` — one screenshot per act, real WebGL, no console errors.
