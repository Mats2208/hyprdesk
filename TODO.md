# TODO

Things that are next, in rough priority order. The [Roadmap in the README](README.md#roadmap) is the shipped-feature view; this is the working list.

## Waiting on a human, on a Mac

None of these can be verified from CI or from Windows. They need hands on an Apple machine.

- [ ] **Window dragging.** The title bar had no hitbox on macOS: the app dragged the window with `-webkit-app-region: drag`, which despite the `-webkit-` prefix is a **Chromium** feature — Windows runs WebView2 (Chromium) and honours it; macOS runs WKWebView and **ignores it entirely**. Now it calls Tauri's `startDragging()`. Verify: drag from the title bar, **double-click to maximize**, and drag from the home screen (which on macOS had *no* drag region at all — it was rendered behind `{!isMac && …}`).
- [ ] **Resize.** Reported as broken alongside the drag, but **not touched**: with `titleBarStyle: Overlay` the native decorations are still active, so resizing from the window edges *should* work on its own. If it is still broken it is a **separate bug** and needs its own hunt.
- [ ] **Energy.** Open Activity Monitor → Energy tab, leave HyprDesk with 2 agents **idle** (not producing output), and read HyprDesk's *Energy Impact*. Low (single digits) is fine. If it sits at 20-30+ **while nothing is happening**, something is still waking the CPU and we keep digging. The known offender is fixed (the PTY flusher woke 40×/second per agent, doing nothing — see `coalesce()` in `lib.rs`), but the *effect* has never been measured on a Mac.
- [ ] **The `.dmg` itself.** Built and downloadable from the *Build installers* workflow (universal — Intel + Apple Silicon). It is **not signed**, so Gatekeeper blocks the first launch: open it with right-click → Open.

## Next up

- [ ] **Tests. There are none.** The workspace persistence layer is the place to start: it is pure, trap-laden logic (atomic writes, index recovery, legacy migration, Windows verbatim paths) and it is the layer that **destroyed a real index on disk** — `workspaces.json` was found as `[]` with every workspace folder still sitting there. CI already runs on Windows and macOS; it should be running these.
- [ ] **Worktree GC.** Orphaned worktrees pile up in `~/HyprDesk/.worktrees/` when a workspace leaves the index (4 had to be deleted by hand). Collect them on startup: a worktree whose workspace hash is no longer known is garbage.
- [ ] **Merge permission, for real.** The "can merge to git" control was removed because nothing read it — write-only UI. If it comes back, gate it in `ControlState::merge` (single implementation now, so it's easy).
- [ ] **Search + scrollback in the terminal.** Scrollback is xterm's default (1000 lines); a long agent run scrolls its own history away.
- [ ] **Linux.** Tauri already builds; the PTY and engine paths need a pass.

## Latent traps (not urgent, will bite eventually)

- [ ] **A WebGL context per terminal, even when hidden.** Every `TerminalTile` attaches `WebglAddon`. With 9 tiles per workspace and workspaces kept alive across tabs (all tiles stay mounted), 3 open workspaces = up to **27 contexts**; Chromium caps around 16 and force-loses the oldest. It degrades gracefully (we dispose and fall back to the DOM renderer) — but it means terminals **silently lose the GPU**, which is the very thing WebGL was added for. A hidden terminal needs no context at all: attach on show, dispose on hide.

- [ ] **Windows argv ceiling.** The composed role travels on the **command line** (`claude --append-system-prompt`, `codex -c developer_instructions=`). `CreateProcess` cuts at ~32.767 chars. Today a worker sits at ~8 KB — comfortable. But a fat role + several default-on skills + a profile persona walks toward 12-15 KB, and it will fail **only on Windows, only with certain profiles**. (OpenCode is safe: it writes the role to a temp file.) The fix, when it's time, is to do what OpenCode does.
- [ ] **A skill name that doesn't exist is ignored in silence.** `with_skills` is best-effort, so a playbook (or a router) naming a skill that isn't installed launches a worker with **nothing** — and nobody finds out. It should at least tell the router.

## Playbooks

- [ ] **A second playbook — from a real run, not invented.** `landing-3d` works because it was transcribed from a project we actually shipped. A playbook that didn't come out of a run is an opinion. Candidates: an API/backend build, a migration, an audit.

## Landing page — 3D ✅ **shipped**

Built by HyprDesk's own agent team in 75 minutes, unattended: one router + four workers on isolated worktrees. Lives in [`web/`](web/), deployed to GitHub Pages on every push, and the brief they were given is [`web/PROMPT.md`](web/PROMPT.md).

Still open on it:
- [ ] The hero act is the weakest frame: the three engines float without a relationship to each other.
- [ ] Mobile: the rig is centred and the copy stacks, but it has **not been driven on a real phone**.

## Known sharp edges

- `cargo fmt` is not enforced — the compact Rust style is deliberate, but that means formatting drifts by hand.
- The frontend bundle is ~1.4 MB (CodeMirror + xterm). Code-splitting the editor would cut the initial load.
