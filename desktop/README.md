# HyprDesk — app (Tauri v2 + React + Rust)

This folder is the HyprDesk desktop app. For the full overview, features,
architecture and install instructions, see the **[root README](../README.md)**.

## Dev

```bash
pnpm install
pnpm tauri dev            # window with hot-reload (runs `build:mcp` first)
```

- `pnpm exec tsc --noEmit` — frontend typecheck
- `cd src-tauri && cargo check` — backend
- `pnpm build:mcp` — bundle the MCP server + roles + skills into `src-tauri/resources/`

## Layout

- `src/` — frontend (React + xterm.js): `store/` · `hooks/` · `layout/` · `FileTile.tsx` (editor) · `commands/` · `theme/` · `settings/`
- `src-tauri/src/` — Rust backend: PTYs + tunnel + engines + worktrees + file ops
- `mcp/` — role-aware MCP server (`hyprdesk-mcp.mjs`), roles (`router-role.md` / `worker-role.md`), and always-on skills (`skills/`)
- `scripts/build-mcp.mjs` — bundles the MCP (self-contained) so it needs no `node_modules` at runtime

Cross-platform (macOS + Windows). Platform-specific code is gated behind `#[cfg(...)]`;
the Unix path is kept identical to the original macOS behavior.
