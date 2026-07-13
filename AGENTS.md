# AGENTS.md

Instructions for AI coding agents working on this repository. (HyprDesk orchestrates agents — it would be embarrassing not to be good to work in.)

## The prime directive

**Minimal functional code. No bloat.**

This project is deliberately small. Before you add anything, ask whether it earns its weight. Do not add:

- abstractions with a single caller
- a dependency for something 20 lines of stdlib can do
- config options nobody asked for
- defensive code for cases that cannot happen
- comments that restate the code

**Dead code is a bug.** If a UI control exists, something must read it. If a function exists, something must call it. We deleted ~1000 lines of exactly this once already — don't put it back.

## Before you claim it works

This is a desktop app driving real PTYs and real agent CLIs. **Typechecking proves almost nothing here.** A change is not done until you have run the app and watched the thing you changed actually happen.

```bash
cd desktop
pnpm exec tsc --noEmit
pnpm build
cd src-tauri && cargo clippy --all-targets -- -D warnings   # zero warnings, CI enforces this
cd .. && pnpm tauri dev                                     # then USE it
```

If you touched terminals, sessions or agents, say which engines you tested with (claude / codex / opencode). They behave differently — that is the whole reason `engines.rs` exists.

## Where things are

| | |
|---|---|
| `desktop/src/store/` | zustand: `sessionStore` (domain) and `uiStore` (chrome). Business logic goes here, not in components. |
| `desktop/src/layout/` | shell, tiles, panels, title bar |
| `desktop/src/terminal/` | terminal keyboard protocol |
| `desktop/src-tauri/src/` | Rust: PTYs (`lib.rs`), tunnel (`control.rs`), engines, worktrees, workspaces |
| `desktop/agent/` | the agent's brain: the MCP server, the **roles** (always injected), the **skills** (domain, for a worker) and the **playbooks** (orchestration, loaded by the router) |
| `docs/ARCHITECTURE.md` | **read this before touching the backend** |

## Conventions

- **Code comments in Spanish. Public docs (README, CONTRIBUTING, issue templates) in English.**
- Comments explain **why**, never what. If a line needs a comment to say what it does, rewrite the line. Comments that record a trap ("this fails on Windows because…") are worth their weight in gold; comments that say `// increment i` are noise.
- Rust uses a compact style (single-line struct literals where they read better). `cargo fmt` is **not** run — match the surrounding code.
- Never `unwrap()` on I/O. A missing file is a normal Tuesday.
- Paths: normalize once at the boundary (`paths::strip_verbatim`). Never let a Windows verbatim path (`\\?\…`) into a string key — it has already broken `--resume` once.

## Traps that have already cost us

- `fs::write` truncates. For anything another thread might read, use `paths::write_atomic`.
- `fs::canonicalize` on Windows returns `\\?\C:\…`. Nobody else uses that form.
- On Windows/ConPTY, a PTY read does not return EOF when the child exits. Wait on the process.
- Returning `false` from xterm's key handler does **not** suppress the browser's default action. Call `preventDefault()`.
- Agents need a sanitized env (`env_clear` + whitelist), or claude won't persist its transcript and `--resume` breaks silently.

## Git

- Commits go to `main`. Conventional-commit prefixes (`fix:`, `feat:`, `refactor:`).
- The message explains the **why** and the failure mode, not a list of files.
- Do **not** add `Co-Authored-By` trailers or any AI-attribution footer.
