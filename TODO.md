# TODO

Things that are next, in rough priority order. The [Roadmap in the README](README.md#roadmap) is the shipped-feature view; this is the working list.

## Landing page — 3D ✅ **shipped**

Built by HyprDesk's own agent team in 75 minutes, unattended: one router + four workers on isolated
worktrees. Lives in [`web/`](web/), deployed to GitHub Pages on every push. The brief they were
given is [`web/PROMPT.md`](web/PROMPT.md).

Still open on it:
- [ ] The hero act is the weakest frame: the three engines float without a relationship to each other.
- [ ] Mobile: the rig is centred and the copy stacks, but it has not been driven on a real phone.


## App

- [ ] **Merge permission, for real.** The "can merge to git" control was removed because nothing read it — write-only UI. If we want it back, gate it in `ControlState::merge` (there is a single implementation now, so it's easy).
- [ ] **Search + scrollback in the terminal.** Scrollback is xterm's default (1000 lines); a long agent run scrolls its own history away.
- [ ] **Worktree cleanup.** Orphaned worktrees accumulate in `~/HyprDesk/.worktrees/` when a workspace is deleted from the index. Garbage-collect on startup.
- [ ] **Tests.** There are none. The workspace persistence layer (index recovery, migration, atomic writes) is exactly the kind of pure, trap-laden logic that deserves them.
- [ ] Linux support (Tauri already builds; the PTY/engine paths need a pass).

## Known sharp edges

- `cargo fmt` is not enforced — the compact Rust style is deliberate, but that means formatting drifts by hand.
- The frontend bundle is ~1.4 MB (CodeMirror + xterm). Code-splitting the editor would cut the initial load.
