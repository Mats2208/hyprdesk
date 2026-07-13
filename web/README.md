# HyprDesk — one router, three engines

A scroll-driven 3D landing page. The three engines (Claude, Codex, OpenCode) are real
objects orbiting a router and wiring themselves into a local A2A tunnel as you scroll.
Real-time WebGL, not a video.

```bash
npm install
npm run dev                                   # http://localhost:5173
npm run build && npm run preview -- --port 4231 --strictPort
npm run shots  -- http://localhost:4231       # .shots/ — one render per act
node scripts/verify.mjs http://localhost:4231 # the behavioural gate
```

**It was built by the thing it describes.** A router agent read the references, wrote the
contract, and delegated four workers — one file each, one git worktree each, reviewed and
merged. The bugs below are the interesting part, because most of them only exist *because*
it was built that way, and could only be found by the one agent holding the integrated tree.

---

## Architecture

```
Lenis → gsap.ticker (ONE RAF)
          ├─ ScrollTrigger → pins + text reveals   (never touches the scene)
          └─ render loop   → poseFromScroll(y) → S → Three.js
```

`S` is **derived** from the scroll position by interpolating a 7-keyframe POSE table. It is
never animated with tweens. One writer, once per frame.

This is not taste. Several `scrub` timelines writing the same properties is a race — the old
act's scrub can land *after* the new one and stomp it. Deriving the state makes it
deterministic, so **jumping to a scroll position produces the same frame as scrolling there**,
which is also the only reason the screenshot harness means anything.

Seven acts: `hero · engines · orbit · tunnel · worktrees · specs · outro`.

**The model** (`scripts/build_model.py` → `public/models/hyprdesk.glb`): procedural Blender,
one command, reproducible. 8 meshes, 6 materials, **4,708 tris, 43.2 KB** Draco-compressed
against a 150 KB budget. **No textures, no UVs, no image files** — the engine marks are
engraved geometry. That deletes the whole UV/`flipY`/`polygonOffset`/z-fighting class of bugs
that cost the reference projects real time, and it survives a close-up that a projected decal
doesn't.

**Measured:** 232 fps median (min 199) on a real GPU at 1600×900, DPR 2.

---

## The tunnel is a simulation, not a loop

Packets travel router ↔ engine along procedural links. The rate is driven by `S.flow` **and
by `|S.scrollVel|`** — *the scroll is the traffic.* The core's load is an underdamped
spring–damper (ζ ≈ 0.30) that flares on a burst and settles on its own.

The velocity term is the whole point: inside an act the rig barely moves, so without it the
tunnel would sit perfectly still exactly while the visitor is reading the paragraph about it.

Measured at the tunnel act, real GPU:

```
rest 0.93  →  peak 1.49  →  settled 0.88        peak = 1.61 × rest
ring-down: 1.34 1.48 1.57 1.57 1.51 1.35 1.03 0.66 0.67 0.78 0.88 …
```

Read that trace, because it's the spec:

- It keeps **climbing for ~300 ms after the input stops.** That isn't lag — it's the packets
  still in flight. Each one that reaches the core kicks the spring's velocity, so traffic
  already on the wire keeps loading the core after you let go. That's what a real queue does.
- Then it crosses rest and **undershoots to 0.66, below the 0.93 resting value**, before
  coming back. **A damped lerp can only approach rest from one side.** Overshooting *past* it
  is the signature of a real underdamped spring, and it's the single assertion that separates
  this page from a video. The gate asserts it.
- Rest is deliberately non-zero: at `flow = 1` the tunnel carries baseline traffic even while
  you sit still reading. Zero *scroll* is not zero traffic. Zero *flow* is — the hero measures
  load 0.00, 0 packets.

---

## Round 2 — art direction

Round 1 was green and wrong. 27/27 passed, the rules held, and the page still didn't land:
the rig was a widget parked in the corner, the three engines read as *cube, ring, gem*, and
the whole thing was staged in a bright editorial room — including the act that is entirely
about light moving on a wire.

**The worst part is that it was already written down.** The round-1 README said, in these
words: *"This rig floats. A hard shadow cast onto an invisible floor answers a question
nobody asked."* The diagnosis was correct, it was made *before* shipping, and it was spent on
prose instead of a fix. **If you can name the flaw, you own it.** A green suite proved the
tunnel simulation rings and settles; it could never have said the hero doesn't make anyone
want to scroll. That is what looking at the renders is for, and it is not optional.

### The shadow is gone

The ground plane, the `ShadowMaterial`, the shadow map, every `castShadow` — deleted. The rig
is an orbital system suspended in space. There is no table. It's now lit as what it is: a
`HemisphereLight` (sky above / shade below — a flat ambient lights the *underside* of a
floating object exactly as hard as its top, which is what makes a render read as a sticker),
softboxes for the long highlights on the cage, and a **rim + kicker** doing the separation job
the shadow was only pretending to do. Self-occlusion comes from a half-res **GTAO** pass that
fades out with `dark` (AO is invisible at near-black, so the dark acts don't pay for it).

`S.shadowOp` is gone from POSE — a prop wired to nothing is the same silent lie as a shadow
with no floor.

### The tunnel burns

`dark: 0.05 → 1` on the tunnel, and `orbit` alongside it, so the page *stays* dark across both
acts. **Emission and bloom do nothing at `#f0efec`.** Pipeline is now
`RenderPass → GTAO → UnrealBloom → OutputPass`, with tone mapping moved to `OutputPass` so the
buffer stays linear — which is exactly what a bloom threshold needs to see.

Bloom is selective *by construction*, not by a second render: only the emissives are pushed
above 1.0 in linear space as `dark` closes, and they're boosted by **different** amounts on
purpose — wire ×(1 + 0.6·dark), packet ×(1 + 3.2·dark). Boosted equally they clip to the same
white and the packet disappears into the wire it's riding, which deletes the one thing the act
is about. Cost, measured at DPR 6 until the frame was GPU-bound: GTAO ~0.35 ms, bloom below
the noise floor. No act pays for both.

Two things had to die for the bloom to earn the darkness. The old additive halo — whose own
comment said its job was *"the bloom read without paying for a post pass"* — now doubled the
glow instead of adding it, and the first render came back with the cage swallowed by a white
sun. And the core's `PointLight` was hitting intensity ~18, flooding every engine the same
pale peach. **`glow` is what the core EMITS, not how hard it floods the room.**

### The engines stopped being interchangeable

Not logos — a form that *carries* a mark beats a form that *is* one, and our hero objects
aren't a trademark fight. The fix was **silhouette by mass**, and the insight that made it
work: scene spins each engine about the **vertical** axis, so **height is the one dimension the
orbit cannot rotate away.** Identity that lives there survives every phase, forever.

```
Claude    TALL   standing faceted blade, heavy belly, chisel roof   2.92 × 1.28
Codex     LOW    machined module lying down, flange, stepped lid    1.90 × 0.80
OpenCode  OPEN   two rims of DIFFERENT radius, six struts, a bore   ~50% air
```

OpenCode's two-rim construction is load-bearing: from dead side-on — the angle the orbit sweeps
every engine through every 95 s — a single ring is a solid black bar and the identity dies. Two
rims read as a **ladder**. And the core went from a 12-fold gem to 8-fold and 3.3:1 tall,
because **an emissive has no shading** (emission is view-independent), so the only thing that
reads it is its outline: a fat glowing gem is just a luminous circle.

### The rig owns the frame — and `orbit` was the lever, not the camera

The rig's *extent* already filled ~70% of the hero. What read as tiny was the **core**: 1.33
against a 4.14 half-extent. Because `orbit: 0.15` parks the dormant engines **far out**, the
hero was a sparse scatter — three dots and a golf ball. `orbit` isn't only a story prop; **it
sets the rig's width.** Opening the hero at `0.45` draws the engines in and makes it an
*object*. The arc still opens to 1.0 across the page.

Reading acts hold ~46% (the copy has to survive). The two dark acts go to **51%** — and that
number is a correction. I first set them to 72%, centred, and the render put the OpenCode ring
straight through *"Spawn a worker per domain"* and the Claude blade through three lines of the
tunnel paragraph. Not a one-off: **the engines orbit, so at some phase every engine lands on
the copy.** A centred rig at 72% and a legible column are geometrically incompatible while the
copy owns half the grid. Drama does not get to eat the words. On black, with the core burning,
51% reads enormous anyway.

---

## The bugs worth writing down

### 1. A simulation can latch NaN forever, and it fails silently

A simulation **accumulates state**, so one bad frame poisons it *permanently*. And the bad
frame arrives: after `scrollTo({immediate: true})` Lenis returns a `NaN` scroll for one tick,
`poseFromScroll` writes it into all of `S`, and the integrator latches it. No console error.
The physics just quietly stops. So inputs are sanitized **and the state heals itself**:

```js
if (![P.load, P.vel].every(Number.isFinite)) { P.load = P.vel = 0; }
```

`dt` is derived from the render loop's own `time` and clamped — a backgrounded tab hands back
a multi-second `dt` that detonates the integrator.

### 2. The theme lerp made the copy vanish — and the reference project had shipped the same bug

The studio's lights going out (`S.dark`: 0 → 1) drives the page's `--bg` / `--fg` in the same
frame. **At `dark = 0.5` they crossed at 1.03:1 contrast.** The copy didn't dim, it
*disappeared*.

The reference project dodged this by hard-coding `dark: 0` on its x-ray act and writing "the
lerp only works at the extremes" in its README. The contract for *this* build faithfully
repeated that as folklore — "mid-lerp is the danger zone, check legibility at 0.5" — i.e. it
told four workers to be *careful* about a landmine instead of removing it.

Fixed at the cause: ink lightness now derives from the *background's own* lightness (oklch
relative colour) and swaps sides exactly where the two would cross. Worst contrast anywhere in
the transition: **3.92:1 headings, 3.40:1 body** (was 1.03:1) — within a hair of the
theoretical ceiling for any ink at that background luminance. The raw tokens failed on their
own too: `--muted` on light was 3.44:1, violet `--accent` on dark 2.70:1.

### 3. `PCFSoftShadowMap` ignores `shadow.radius`

The contact shadows landed as detached grey **smudges** beside the objects. Three independent
causes, one symptom:

- `PCFSoftShadowMap` uses a fixed ~1-texel kernel and **ignores `shadow.radius` entirely** —
  a soft shadow was unreachable at any setting. Anyone "turning the softness up" would have
  been adjusting a knob wired to nothing. → `VSMShadowMap`.
- The key light sat ~50° off vertical. Fine for an object that *rests*; a **hanging** object
  throws its shadow sideways ~1.2× its height until it detaches. → steepened to 13°.
- The shadow frustum was fixed in world space while the rig slides across it
  (`groupX` −1.3…+1.5) — simultaneously low-res *and* clipping. → it now rides the rig.

The deeper error was architectural, and it was the router's: the ground + contact shadow were
lifted from a reference project where a thermos **sits on a table**, and that shadow is
exactly what separates a render from product photography. This rig is an orbital system
floating in space. There is no table. A hard cast shadow onto an invisible floor answers a
question nobody asked.

### 4. The hero was the widest frame on the page

Four of seven acts cropped an engine. The camera framing was solved against a rig half-extent
of `1.5` — but the rig **breathes with the story**:

```
engineRadius = RING · (1 + (1 − orbit) · 0.55) + split · 1.5
```

A **low `orbit` makes the rig wider**, because dormant engines are parked *far out* and drawn
in as the orbit closes. So the hero (`orbit 0.15`) — the calm establishing shot, the first
thing anyone sees — has the widest silhouette on the page. Every instinct says the hero is the
safe frame. It's the worst one.

And it's worse than a static miss: **the engines never stop orbiting** (`phase += dt · 0.12 ·
orbit`, ~95 s per revolution), so any single measurement — or screenshot — samples one
arbitrary phase and proves nothing. Tuned on one phase, **six of seven acts cropped at some
other phase, worst by 153 px.** Every act is now solved against the *phase-swept* worst case,
and the formula lives above `POSE` so the coupling can't go invisible again.

### 5. The splitter trap, twice

```css
.act__title span   { display: block; }  /* ✗ */
.act__title > span { display: block; }  /* ✓ */
```

The splitter injects a `<span class="w">` per word; a **descendant** selector matches those
too, with higher specificity than `.w` — one word per line, long ones clipped by
`.w { overflow: hidden }`. Third project in a row.

New variant, same family: `.eyebrow` was `display: flex`, and **a flex container drops the
whitespace text nodes the splitter leaves between words** → `LOCAL-FIRSTAGENTORCHESTRATION`.

### 6. The harness screenshotted someone else's build and reported it green

`npm run preview` on a port another process already held, plus a harness pointed at the
default URL, produced **seven clean screenshots and zero console errors — of a page we hadn't
built.** The only tell was the act anchors coming back evenly spaced at 900 px (the unpinned
fallback) instead of at real pin positions.

Failures that fail *successfully* are the dangerous ones. Now: `--port <n> --strictPort`, the
same URL handed to the harness, and `shots.mjs` wipes `.shots/` before rendering so a stale
render can never survive into a review.

### 7. The gate blamed the simulation for what the gate was doing

The tunnel assertion failed — `rest 0.93 → burst 1.07`, a 15 % rise — and very nearly sent a
worker off to "fix" a simulation that was already correct. Both bugs were in the *test*:

- The burst scrolled in **one direction**, which walks the page *out of the tunnel act*,
  dropping `flow` and taking the load down with it. It now oscillates: `|velocity|` stays
  high, the page stays in the act.
- It took **one sample, 160 ms after the input** — but the load peaks ~300 ms *after* you let
  go and then undershoots below rest, so a single late sample lands anywhere on that curve. It
  now samples continuously, takes the peak, and watches 2.7 s of ring-down (the undershoot
  doesn't arrive until ~1.2 s).

The lesson isn't "tests lie." It's that a red test is a claim about the *system*, and it is
worth the ten minutes to ask which half of the system it's actually indicting — because the
cost of getting that wrong is distorting correct code until a bad measurement goes green.

---

## Accessibility

`prefers-reduced-motion` via `gsap.matchMedia()`: no Lenis, no pins, no scrubs, no custom
cursor, all text visible, the scene parked in the hero pose. The engine picker still works.
Asserted, not assumed. Contrast holds through the entire dark lerp (§2). Below 900 px the grid
collapses, the canvas dims to an ambient backdrop, and `groupX` is zeroed **inside
`poseFromScroll`** — a media-query listener writing `S` would be a second writer, and that is
the one rule this architecture doesn't bend.

## Verification

`node scripts/verify.mjs <url>` — 27 assertions across three sections: motion (fps, the tunnel
simulation, marquee-vs-velocity, magnetic cursor, the picker), reduced-motion, and a resize
round-trip across the 900 px breakpoint (pins are torn down and rebuilt, poses re-anchor, the
hero must not re-hide itself). Section 1 runs **headed, on a real GPU** — SwiftShader would
report the speed of a software rasterizer, not the page.

`npm run shots -- <url>` — one render per act, real WebGL, fails on any console error.

The fps in the `.shots/` renders is software rasterization, not the real thing. The real
number is 232 fps median.
