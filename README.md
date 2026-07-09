# 🧭 HyprDesk

**Un gestor de terminales estilo window manager (inspirado en Hyprland) donde los agentes de IA
se interconectan y colaboran entre sí.**

Cada terminal es real (PTY del sistema). Uno de ellos es un **router** — un agente con el que
hablás — que delega tareas a **workers** — otros agentes en sus propias terminales. Router y
workers se comunican por un **túnel bidireccional** (vía MCP): se hacen queries, se reportan el
trabajo, y vos podés intervenir en cualquiera de ellos.

> ⚠️ **Esto es un PROTOTIPO / experimento**, no un producto terminado ni un desarrollo final.
> Es un espacio para explorar la idea de orquestación de agentes tipo **A2A (Agent2Agent)** con
> una UI de escritorio. Muchas cosas están a medio hacer y van a cambiar. Se sube a GitHub
> principalmente para tener **persistencia** e ir iterando.

---

## Qué funciona hoy

- 🖥️ **Terminales reales** embebidas (xterm.js + PTY vía Rust/Tauri): escribís, ejecutás, corrés
  `claude`, `codex`, `htop`, lo que sea.
- 🎛️ **Layout dinámico** tipo tiling (router a la izquierda con prioridad, workers en grilla),
  con divisor arrastrable, foco por teclado, cerrar/maximizar.
- 🧠 **Router = agente Claude Code interactivo** (elegís el agente en un selector al inicio).
- 🔌 **Delegación por MCP**: el router usa `spawn_worker` / `send_to_worker`; el worker usa
  `report_to_router` / `ask_router`. El "túnel" entrega mensajes inyectándolos en el PTY del
  agente destino.
- 🔁 **Túnel bidireccional**: el router delega, el worker trabaja de forma autónoma, le reporta
  al router cuando termina, y el router revisa. Vos también podés hablarle directo a un worker y
  él le avisa al router lo que hizo.

## Arquitectura (resumen)

```
Tile ROUTER (claude interactivo + MCP hyprdesk)
   │  spawn_worker / send_to_worker
   ▼   (MCP → control server local de la app → inyección por PTY)
Tile WORKER (claude interactivo + MCP hyprdesk)
   │  report_to_router / ask_router
   └──────────► el router revisa e itera
```

- **Frontend**: React + xterm.js (`desktop/src/`).
- **Backend**: Rust/Tauri — manager de PTYs + control server HTTP local que rutea el túnel
  (`desktop/src-tauri/src/`).
- **MCP**: servidor stdio role-aware que expone las tools de cada agente (`desktop/mcp/`).

## Estructura del repo

```
desktop/   → la app HyprDesk (Tauri v2 + React + Rust). El proyecto principal.
  src/            frontend (tiles, layout, selector)
  src-tauri/      backend Rust (PTYs, control server / túnel)
  mcp/            MCP server + roles (router/worker)
cli/       → prototipo previo: orquestador router→worker por CLI, agnóstico
             al agente (claude/codex/opencode). Standalone.
```

## Cómo correr

Requisitos: Node 20+, pnpm, Rust/Cargo, y los CLIs de agentes instalados y logueados
(`claude` para la v1). macOS (probado).

```bash
# 1) dependencias
cd desktop && pnpm install
cd mcp && pnpm install && cd ..

# 2) correr en dev (abre la ventana)
pnpm tauri dev
```

En el selector elegí **Claude Code**, y pedile algo al router (ej. *"creá una web de X en ~/…"*).
Vas a ver nacer un worker que lo hace y le reporta.

## ⚠️ Seguridad

Los workers corren con `--dangerously-skip-permissions` para poder trabajar de forma autónoma
(crear archivos, correr comandos). Es apropiado solo en una máquina local de confianza. **No lo
uses con tareas o entradas no confiables.**

## Roadmap / próximos pasos

- [ ] Reubicar workspaces fuera del home (hoy los proyectos caen en `~/`, poco seguro) →
      carpetas de workspace elegibles por el usuario.
- [ ] Persistencia real de conversaciones y sesiones (resumir/rehidratar agentes).
- [ ] Soportar otros agentes como router/worker (Codex, OpenCode).
- [ ] Worktrees git por worker para paralelismo sin conflictos.
- [ ] Pegar imágenes en cualquier tile; badges de notificación entre agentes.

---

Prototipo personal de [@Mats2208](https://github.com/Mats2208). WIP 🚧
