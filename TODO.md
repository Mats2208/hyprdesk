# TODO

Things that are next, in rough priority order. The [Roadmap in the README](README.md#roadmap) is the shipped-feature view; this is the working list.

## Next up

- [ ] **Tests. There are none.** The workspace persistence layer is the place to start: it is pure, trap-laden logic (atomic writes, index recovery, legacy migration, Windows verbatim paths) and it is the layer that **destroyed a real index on disk** — `workspaces.json` was found as `[]` with every workspace folder still sitting there. CI already runs on Windows and macOS; it should be running these.
- [ ] **Worktree GC.** Orphaned worktrees pile up in `~/HyprDesk/.worktrees/` when a workspace leaves the index (4 had to be deleted by hand). Collect them on startup: a worktree whose workspace hash is no longer known is garbage.
- [ ] **Merge permission, for real.** The "can merge to git" control was removed because nothing read it — write-only UI. If it comes back, gate it in `ControlState::merge` (single implementation now, so it's easy).
- [ ] **Search + scrollback in the terminal.** Scrollback is xterm's default (1000 lines); a long agent run scrolls its own history away.
- [ ] **Linux.** Tauri already builds; the PTY and engine paths need a pass.

## Latent traps (not urgent, will bite eventually)

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
