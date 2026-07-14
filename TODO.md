# TODO

Things that are next, in rough priority order. The [Roadmap in the README](README.md#roadmap) is the shipped-feature view; this is the working list.

## Before the beta tag

- [ ] **Verify on Windows.** Everything in *Done* below was verified on macOS, on a real machine. The Windows half of the beta has **not been driven by a human** since the last round of changes. It builds in CI, which proves it compiles — not that it works. What needs eyes: the frameless title bar (custom menu + window controls — macOS uses the native ones, so that code path is exercised **only** on Windows), window drag/resize, and that SmartScreen's "Run anyway" actually gets the `.exe` open.

## Waiting on a human, on a Mac

- [ ] **Energy.** Still **not measured**. Memory was: with 2 agents up, HyprDesk's own footprint is ~275 MB (WebView 189 + shell 31 + GPU 38 + Metal compiler 17) — normal for a WebView app, and the `claude` processes sitting next to it are the agents themselves, not us. But *Energy Impact* is a different number and nobody has read it. Activity Monitor → **Energy** tab, 2 agents **idle** (not producing output). Single digits is fine; 20-30+ **while nothing is happening** means something is still waking the CPU. The known offender is fixed (the PTY flusher woke 40×/second per agent, doing nothing — see `coalesce()` in `lib.rs`, guarded now by the `en_reposo_no_emite_nada` test).

## Next up

- [ ] **The MCP server dies mid-session, and we don't know why.** The agent sees `Transport closed`; the `node` process is simply gone. Seen on **claude and codex** while the agent itself was still alive and working — a router in a real session announced *"the HyprDesk MCP disconnected, so I'll integrate with git directly"*. **Not** caused by a failing tool call (proven: the server survives a call against a dead control server and returns a clean error). The instrumentation to catch it now exists — `~/HyprDesk/logs/mcp-<agent>.log` records the exit and any uncaught exception. **Next time it happens, read that log.**
- [ ] **Agents now inherit every user MCP** (dropping `--strict-mcp-config` was right — an agent inside HyprDesk shouldn't be able to do *less* than one outside). But that means every worker pays for every tool schema the user has installed: one MCP with 43 tools is 43 tools in *each* agent's context. If it starts to hurt, a Settings toggle ("agents inherit my MCP servers") is the fix — not going back to isolating them by default.
- [ ] **The control server has no authentication.** It listens on `127.0.0.1` with an ephemeral port and its only defence is that nobody knows the port. A web page could scan localhost and fire `POST /spawn_worker` — the browser wouldn't let it *read* the response, but the POST still **runs**. Cheap fix: a token in `mcp_env` (`engines.rs`), required as a header.
- [ ] **The OpenCode logo reads as a broken-image glyph** at 16px (`src/assets/engines/opencode.png` is a black tile with a hollow white rectangle). Redraw it as an inline SVG, like `BrandMark`.
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
- **The installers are unsigned.** Gatekeeper (macOS) and SmartScreen (Windows) both warn on first launch; the README says how to get past it. Signing needs a paid Apple / Microsoft developer account.

---

## Done

Kept because each line names a bug that was actually paid for — this is not a changelog.

- [x] **The router used its *engine's* subagents, not HyprDesk's.** Codex ships `spawn_agent` / `list_agents` / `send_message` / `wait_agent` natively; OpenCode ships `task`; Claude ships `Task`. Two near-identical toolsets with the same semantics — and the router picked its own, which is the sensible thing to do when both are on the table. The result: **an empty app**, not a single tile, while the router reported that it had "coordinated three workers in parallel". They can't be turned off (with `features.enable_fanout=false` codex's tool list is byte-identical), so the only lever is the role — and the rule ships **with its consequence**, because a rule without one is a preference, and preferences lose under pressure.
- [x] **Workers on OpenCode started before the tunnel existed, and stayed mute.** The initial task was typed into the PTY after a **hardcoded `sleep(6s)`**, with no idea whether the MCP had connected. A race — and only OpenCode ran it: claude and codex get the task as `argv`, so their CLI finishes booting (MCP included) before the model's first turn. When OpenCode lost the race the model started working **without the tunnel's tools and never looked again**: the worker couldn't `report_to_router` even if it wanted to — *it didn't have it*. One of them reverse-engineered our own `.mjs`, found the endpoint, and tried to POST by hand. Now the MCP **announces itself** (`/mcp_ready`, from `server.oninitialized`) and the app waits for that signal before speaking.
- [x] **Claude agents lost every user MCP.** We passed `--strict-mcp-config`, which per `claude --help` means *"only use MCP servers from `--mcp-config`, ignoring all other MCP configurations"*. An agent inside HyprDesk could do **less** than the same agent outside it. Codex never had the bug (its `-c` flags merge), which is why it went unnoticed.
- [x] **`Ctrl+V` pasted twice, and could send the message for you.** The handler returned `false` so xterm wouldn't encode the key — but that does **not** cancel the DOM event, so WebView2 ran its native paste on xterm's hidden `<textarea>` as well. Two writes to the PTY. The duplication wasn't the dangerous part: xterm's copy is wrapped in *bracketed paste* and ours went **raw**, so the newlines of a multi-line paste arrived as real Enters and the agent sent the message half-written. Windows only — on macOS the native menu takes `Cmd+V` before the webview sees it.

- [x] **Window dragging (macOS).** The title bar had no hitbox: the app dragged with `-webkit-app-region: drag`, which despite the `-webkit-` prefix is a **Chromium** feature — Windows runs WebView2 (Chromium) and honours it; macOS runs WKWebView and **ignores it entirely**. Now it calls Tauri's `startDragging()`. Verified on a Mac: drag, double-click to maximize, and drag from the home screen.
- [x] **Resize (macOS).** Verified on a Mac. It was never a separate bug — with `titleBarStyle: Overlay` the native decorations stay active and resize worked on its own; it only *looked* broken because the drag was.
- [x] **The `.dmg`.** Builds, installs, and runs. Universal (Intel + Apple Silicon) from the *Build installers* workflow, and now attached to the GitHub Release on a tag.
- [x] **Tests.** 12 of them, concentrated on the layer that **destroyed a real index on disk** (`workspaces.json` was found as `[]` with every workspace folder still sitting there): atomic writes, index recovery from the state files, legacy migration, "a failed read is never persisted", "deleting a linked workspace never touches the user's folder". Plus worktree GC and the idle flusher. CI runs them on Windows and macOS.
- [x] **Worktree GC.** Orphaned worktrees piled up in `~/HyprDesk/.worktrees/` when a workspace left the index (4 had to be deleted by hand). `worktree::gc_orphans()` collects them at startup: a worktree whose workspace hash is no longer known is garbage.
- [x] **A WebGL context per terminal, even when hidden.** Every `TerminalTile` attached `WebglAddon` on mount — including the tiles of *inactive* workspaces, which stay mounted (their view is hidden with `display:none`). 3 open workspaces × 9 tiles = up to **27 contexts**; Chromium caps around 16 and force-loses the oldest, so terminals **silently lost the GPU** — the exact thing WebGL was added for. An `IntersectionObserver` now attaches the addon on show and disposes it on hide: a hidden terminal holds no context.
- [x] **Icon buttons were off-centre.** The browser gives every `<button>` a default `padding: 1px 6px`, and it was never reset. With `box-sizing: border-box` and a fixed square, that padding ate the content box: the 26px `☰` was left with 12px of room for a 16px glyph and pushed it **4px to the right**; the 16px tab-close button had **4px**. One `button { padding: 0 }` reset fixes all of them — the buttons that do want padding declare it in their own class and win on specificity.
