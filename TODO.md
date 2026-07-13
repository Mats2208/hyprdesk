# TODO

Things that are next, in rough priority order. The [Roadmap in the README](README.md#roadmap) is the shipped-feature view; this is the working list.

## Landing page — 3D 🔥

A real landing site for HyprDesk, scroll-driven and in 3D: **the three engines (Claude · Codex · OpenCode) as 3D models**, orbiting a router, wiring themselves into the local A2A tunnel as you scroll. Awwwards-grade, not a template.

- Stack: Three.js / React Three Fiber + GSAP ScrollTrigger + Lenis
- Lives in `web/` — **gitignored for now**, on purpose: it does not ship until it's good
- Beats: hero (the three engines) → router leads, workers spawn → live terminals → git worktrees merge back → download
- Models: hard-surface, procedurally built (not AI image-to-3D — that geometry is unusable for this)
- Must not bloat the app repo: it's a separate build, its own `package.json`, zero coupling to `desktop/`

## App

- [ ] **Merge permission, for real.** The "can merge to git" control was removed because nothing read it — write-only UI. If we want it back, gate it in `ControlState::merge` (there is a single implementation now, so it's easy).
- [ ] **Search + scrollback in the terminal.** Scrollback is xterm's default (1000 lines); a long agent run scrolls its own history away.
- [ ] **Worktree cleanup.** Orphaned worktrees accumulate in `~/HyprDesk/.worktrees/` when a workspace is deleted from the index. Garbage-collect on startup.
- [ ] **Tests.** There are none. The workspace persistence layer (index recovery, migration, atomic writes) is exactly the kind of pure, trap-laden logic that deserves them.
- [ ] Linux support (Tauri already builds; the PTY/engine paths need a pass).

## Known sharp edges

- `cargo fmt` is not enforced — the compact Rust style is deliberate, but that means formatting drifts by hand.
- The frontend bundle is ~1.4 MB (CodeMirror + xterm). Code-splitting the editor would cut the initial load.
