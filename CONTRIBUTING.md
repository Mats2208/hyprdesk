# Contributing to HyprDesk

Thanks for being here. HyprDesk is a small, opinionated project: **a router agent that leads a team of workers**, and as little else as possible.

## The one rule

**Minimal functional code. No bloat.**

Every line has to earn its place. A PR that adds a feature by adding 500 lines of scaffolding, a new dependency, and a config panel is a PR that makes the project worse — even if the feature is good. Dead code, duplicated logic, abstractions with a single caller, and UI controls that don't actually do anything are all treated as bugs here.

If a control exists in the UI, something must read it. If a function exists, something must call it. That is not a style preference; it is what keeps a project this size understandable by one person.

## What gets merged easily

- Bug fixes — especially with a repro
- Platform quirks (Windows/macOS path handling, PTY behaviour, terminal escape sequences)
- Support for a new agent engine (see `desktop/src-tauri/src/engines.rs`)
- Making an existing feature actually work end to end
- Deleting things that nothing uses

## What needs a conversation first

- New UI surfaces (panels, modals, tabs)
- New dependencies — the bar is high, say why the stdlib/existing deps can't do it
- Anything that changes the router→worker model

Open an issue before writing the code. A rejected PR is a waste of your evening, and I'd rather save you that.

## Getting set up

**Requirements:** macOS or Windows · [Node 20+](https://nodejs.org) · [pnpm](https://pnpm.io) · [Rust](https://rustup.rs) · `git` in PATH.
On Windows you also need the [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++") — that's Rust's MSVC linker.

Plus at least the `claude` CLI installed and logged in (`codex` / `opencode` are optional).

```bash
git clone https://github.com/Mats2208/hyprdesk.git
cd hyprdesk/desktop
pnpm install
pnpm tauri dev
```

## Before you open the PR

CI runs exactly this, on both Windows and macOS. Run it locally first and save yourself a round trip:

```bash
cd desktop
pnpm exec tsc --noEmit                              # typecheck
pnpm build                                          # frontend build

cd src-tauri
cargo clippy --all-targets -- -D warnings           # zero warnings, enforced
cargo check --all-targets
```

Note: `cargo fmt` is **not** enforced. The Rust here uses a deliberately compact style (single-line struct literals where they read better) that rustfmt would blow up. Match the surrounding code instead.

Then **actually run the app** and use the thing you changed. This is a desktop app driving real PTYs and real agents; a green typecheck proves very little. If you touched terminals, sessions or agents, say in the PR which engines you tested with.

## The codebase in 30 seconds

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before touching the backend — it explains the tunnel, the PTY layer, worktree isolation and how sessions persist, including the traps that already bit us once.

```
desktop/src/          React frontend — store/ (zustand) · layout/ · hooks/ · commands/ · terminal/
desktop/src-tauri/    Rust backend — PTYs, the A2A tunnel, engine adapters, git worktrees, workspaces
desktop/agent/        the agent's brain — MCP server · roles (always on) · skills (worker) · playbooks (router)
cli/                  an earlier standalone prototype, kept for reference
```

Code comments are in Spanish; public docs (README, this file, issue templates) are in English. Comments explain **why**, not what — if a line needs a comment to say what it does, rewrite the line.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
