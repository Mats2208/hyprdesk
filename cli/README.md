# a2a — Harness de orquestación router+worker (agnóstico al agente)

Una **capa por encima** de cualquier agente-CLI de código. No es "para Claude": es un
harness genérico que orquesta a **Claude Code, Codex u OpenCode** (o el que agregues)
de forma intercambiable, bajo un patrón **router → worker** con sesiones persistentes.

La idea: PC nueva → instalás los agentes que quieras (`claude`, `codex`, `opencode`) →
instalás este harness → orquestás cualquiera de ellos como router o worker, mezclándolos.

Sin dependencias npm, sin API keys propias: usa el login/CLI de cada agente en modo headless.

## Correr

```bash
node harness.mjs "tu objetivo de alto nivel"

# elegir motores (adapter[:model]) para router y worker — ¡se pueden mezclar!
ROUTER=claude:opus   WORKER=codex                              node harness.mjs "..."
ROUTER=claude:sonnet WORKER=opencode                           node harness.mjs "..."
ROUTER=codex         WORKER=opencode:anthropic/claude-sonnet-4-6 node harness.mjs "..."

# worker con herramientas reales (edita código, corre comandos)
WORKER_TOOLS="Read Edit Bash" node harness.mjs "..."
```

Variables de entorno:

| var            | default        | qué hace                                          |
|----------------|----------------|---------------------------------------------------|
| `ROUTER`       | `claude:sonnet`| motor del router, formato `adapter[:model]`       |
| `WORKER`       | `claude:sonnet`| motor del worker, formato `adapter[:model]`       |
| `MAX_ITERS`    | `6`            | tope de iteraciones router↔worker                 |
| `WORKER_TOOLS` | (sin setear)   | herramientas del worker; vacío = razonador puro   |

## Arquitectura

```
                         ┌───────────────────────────┐
   "adapter[:model]"  →  │   HARNESS (harness.mjs)    │
                         │  bucle router→worker,      │
                         │  robustez de formato JSON  │
                         └────────────┬──────────────┘
                                      │ habla solo con la interfaz común
                         ┌────────────▼──────────────┐
                         │   Capa de ADAPTERS         │
                         │   run({prompt, systemPrompt,│
                         │       sessionId, model,     │
                         │       tools}) → {result,    │
                         │       sessionId, cost}      │
                         └──┬───────────┬───────────┬──┘
                            │           │           │
                       ┌────▼───┐  ┌────▼───┐  ┌────▼─────┐
                       │ claude │  │ codex  │  │ opencode │   ← agentes intercambiables
                       └────────┘  └────────┘  └──────────┘
```

- **Adapter** = envuelve un agente-CLI (headless + JSONL + sesión resumible) en una
  interfaz única. Cada agente expone las mismas 3 cosas con nombres distintos:

  |          | sesión id                  | texto final                | resume            |
  |----------|----------------------------|----------------------------|-------------------|
  | claude   | `.session_id`              | `.result`                  | `--resume <id>`   |
  | codex    | `thread.started.thread_id` | `item.completed`           | `exec resume <id>`|
  | opencode | `.sessionID`               | partes `type:"text"`       | `run -s <id>`     |

- **Persistencia / iteración** = el worker mantiene su `sessionId`; si el router no
  aprueba, se re-delega sobre la **misma** sesión (conserva contexto), no de cero.
- **Robustez** = el harness tolera que el router rompa el formato JSON (retry
  correctivo + fallback), un problema real y frecuente al orquestar LLMs por prompt.

## Agregar un agente nuevo

1. Creá `adapters/<nombre>.mjs` que exporte `{ name, bin, defaultModel, async run(...) }`
   siguiendo el contrato (ver `adapters/claude.mjs` como plantilla).
2. Registralo en `adapters/index.mjs` (una línea).

Eso es todo — el harness ya lo puede usar como router o worker.

## Relación con A2A (Agent2Agent)

Este patrón es lo que modela el protocolo abierto **A2A**: router = *Client Agent*,
worker = *Remote Agent*, "el worker se toma su tiempo" = **Task** async, resumir la misma
sesión = **`contextId`**, pausar y pedir datos = **`input-required`**, reportes = **Artifacts**.

## Próximos pasos

1. **Múltiples workers en paralelo** (ej. un "coder" claude + un "reviewer" codex).
2. **`input-required`**: worker pausa y pide aclaración antes de seguir.
3. **Capa visual** encima del harness (en diseño).
4. **Migrar al protocolo A2A real** (Agent Cards + JSON-RPC sobre HTTP).
