# HyprDesk — slice mínimo (terminal REAL en Tauri)

Prueba de concepto de la pieza crítica: **una terminal de verdad embebida en una UI web**
(el patrón que va a llevar todos los tiles del workspace estilo Hyprland).

## Las 3 capas

```
xterm.js (React)        ← la pantalla: dibuja y captura teclado
   ↕  eventos / invoke
portable-pty (Rust)     ← el PTY REAL del SO: acá corre tu shell de verdad
   ↕
tu shell ($SHELL -l)    ← podés correr ls, git, y hasta `claude` / `codex` adentro
```

- `src/TerminalTile.tsx` — componente xterm.js puenteado al backend.
- `src-tauri/src/lib.rs` — manager de PTYs: `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`.
- El texto viaja como base64 (bytes crudos) para no corromper UTF-8.

## Correr

```bash
cd desktop
pnpm install          # (ya hecho)
pnpm tauri dev        # abre la ventana de escritorio
```

Dentro de la terminal probá: `ls`, `git status`, o directamente `claude` / `codex` —
corre el CLI REAL, con todos sus skills / MCP / comandos `!`, porque es una terminal real.

## Por qué es la base de todo

Cada tile del diseño final = una instancia de esto. Multiplicar tiles + reorganizar layout
+ enchufar el harness (`../harness.mjs`) que abre tiles-worker = el workspace completo.

## Próximo

1. Multiplicar tiles con layout dinámico (1 → 2 columnas → 2x2 → grilla).
2. Estética Hyprland completa (wallpaper, sidebar widgets, animaciones de layout).
3. El "router" abre tiles-worker vía el harness y los coordina por session_id.
