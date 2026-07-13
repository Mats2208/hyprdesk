# Prompt for the HyprDesk router

Open `E:\PROYECTOS\hyprdesk\web` as a workspace (*Open an existing folder…*), start a **Claude** router, and paste this.

---

You are the router. We're building the **HyprDesk 3D landing page** — and you will build it **by delegating to your team**, because the landing page *is* a demo of you doing exactly that. Build it alone and there is no demo.

## What it is

A scroll-driven 3D experience where **the three engines (Claude, Codex, OpenCode) are real 3D objects** orbiting a router and wiring themselves into a local A2A tunnel as the visitor scrolls. Awwwards-grade. Real time, not a video.

## Stack — non-negotiable

Copy the exact stack of `E:\PROYECTOS\IPHONE-3D` and `E:\PROYECTOS\STANLY-DOLARBLUE`. **Read them before you write a line** — they are the bar and the house style.

```
Vanilla JS + Vite 5   ·   build.target 'esnext'   ·   assetsInlineLimit 0
three@^0.169.0   (import from three/addons/…)
gsap@^3.12.5     (+ ScrollTrigger)
lenis@^1.1.13
```

**No** React, Next, TypeScript, Tailwind, R3F, drei, framer-motion. None of it gets in.

## Architecture — three files, one contract

```
index.html      semantic markup, one <section> per act
src/scene.js    THE ENGINE. Exposes state S, render(t), applyX(). Knows nothing about scroll.
src/main.js     THE DIRECTOR. Lenis + ticker + poseFromScroll + ScrollTrigger + UI.
src/styles.css  tokens (--bg --fg --accent --line --disp --ui --pad) + layout
public/models/  the .glb files (generated, not downloaded)
public/draco/   the decoder, served locally
scripts/        Blender headless (Python) + optimize.mjs (gltf-transform)
```

## The six rules

1. **Lenis → ONE `gsap.ticker` → `poseFromScroll(y)` → `S` → render.** The camera is **derived** from scroll by interpolating a `POSE` table with `smoothstep`. It is **never tweened**. ScrollTrigger only pins and reveals text — it **never touches the scene**. (You know why: several scrubs writing `S` race each other, and you get one act's framing with another act's copy.)
2. **One writer of `S` per frame.** Deterministic: jumping the scrollbar must produce the same frame as scrolling there.
3. **Keyframes anchor to each pin's REAL scroll extent** (`tl.scrollTrigger.end`) and are rebuilt on `ScrollTrigger.addEventListener('refresh', …)`.
4. **Meshes and materials by NAME.** Never `traverse(o => o.material = x)`.
5. **Honour `prefers-reduced-motion` and `(hover: none)`** via `gsap.matchMedia()`: no Lenis, no scrubs, no cursor, all text legible. `setPixelRatio(Math.min(devicePixelRatio, 2))`.
6. **Comments explain the BUG they prevent**, never what the line does. Write them in English — this repo is the project's public face.

## The 3D models — procedural, Blender headless

Blender 5.1 lives at `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe` and its headless GLB export is verified working.

**No image-to-3D generators** (Meshy/Tripo/etc.): for hard-surface marks they produce melted geometry with no topology and no usable UVs. You already paid for that lesson in `DOLAR_NEW-MERCH-TEST` — which is why `scripts/lib/blender_lib.py` exists. **Reuse it.**

Four objects, clean geometry, readable in silhouette:

- **Claude** — the Anthropic burst. Beveled extrusion, warm orange `#d9a06b`.
- **Codex** — the OpenAI knot. Hard-surface, blue `#8b9cff`.
- **OpenCode** — its mark. Green `#34d399`.
- **The router** — the one that leads: its own geometry, heavier, at the centre.

Optimize with `gltf-transform`: `weld/dedup/prune` + **Draco**, and **never `--simplify`** (it facets the bevels in close-up). Target: **< 150 KB per model**.

## The script (the acts)

1. **hero** — the three engines floating, still, in near-darkness. The claim.
2. **router** — the router lights up and moves in; the three begin to orbit it. *"One agent leads. It doesn't dispatch — it thinks."*
3. **spawn** — the workers multiply and fan out into a grid. *"It delegates execution. In parallel."*
4. **tunnel** — the A2A wires draw themselves between them: emission + bloom. *"They talk to each other. On your machine."*
5. **worktrees** — each worker takes its own branch; the branches converge and merge back into one.
6. **outro** — download + repo.

## How I want you to delegate

**First, alone** (do not delegate this): read the reference projects, write `index.html` with the sections, and **fix the contract** — the exact shape of `S`, the prop names (`rotY, camX/Y/Z, fov, bloom, ty, groupX/Y, idleSpin, mouseX/Y, …`), the act names in the `POSE` table, and the API `scene.js` exposes to `main.js`. That contract is what lets the team work **in parallel without colliding**. Commit it.

**Then delegate** — one worker per file, single owner, zero collisions:

| worker | owns | skills to load |
|---|---|---|
| **models** | `scripts/*.py`, `scripts/optimize.mjs`, `public/models/*.glb` | `procedural-3d-modeling` |
| **scene** | `src/scene.js` | `threejs-materials`, `threejs-lighting`, `threejs-postprocessing` |
| **director** | `src/main.js` | `gsap-scrolltrigger`, `lenis-smooth-scroll`, `scroll-3d-product-page` |
| **style** | `src/styles.css`, the `index.html` copy | `premium-web-design`, `ui-ux-pro-max` |

Tell each worker to **load its skill first** and to **read `E:\PROYECTOS\STANLY-DOLARBLUE` as the reference** before writing anything.

**models** starts first, or in parallel from the very beginning: without the `.glb` files the others are working blind. While Blender bakes, **scene** and **director** can build against the contract using a placeholder (a `BoxGeometry` carrying the same material name).

**Review with `review_worker` before you merge.** If a worker broke a rule — tweened the camera, painted via `traverse`, smuggled in React — reject it and re-delegate. **Do not merge blind.** You're the critic, not a mail slot.

## Done means

- `npm run dev` runs and the **console is at zero errors**.
- A `.shots/` folder with **one screenshot per act** (Playwright with WebGL), like the other projects.
- **FPS HUD visible** — the whole point is that it's real time. 60fps on desktop.
- Preloader with a real counter (from the GLTFLoader's `onProgress`), `[data-split]` text splitter, magnetic cursor, and a marquee reacting to Lenis's velocity.
- Works under `prefers-reduced-motion: reduce` (no animation, every word legible).
- The `.glb` files hit their budget (< 150 KB) and are **reproducible**: re-running the Blender script regenerates them.
- A README that explains the decisions **with numbers** (why that segment count, why not `simplify`).

Finish with `save_memory`: what you learned and what's still open.

**Go.** Read the references, fix the contract, build your team.
