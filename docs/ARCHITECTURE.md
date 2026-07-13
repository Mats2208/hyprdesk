# Architecture

How HyprDesk actually works, and the traps that already bit us. Read this before touching the backend.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Webview (React)                                                      │
│    store/sessionStore  ← domain: open workspaces, tiles, agents       │
│    store/uiStore       ← chrome: panels, modals, toasts               │
│    TerminalTile        ← one xterm.js per agent                       │
└───────────┬───────────────────────────────────────────────▲───────────┘
            │ invoke("pty_write", …)                        │ emit("pty-output")
            ▼                                               │
┌───────────────────────────────────────────────────────────┴───────────┐
│  Rust (Tauri v2)                                                      │
│    lib.rs        PTY manager — real OS terminals, one per agent       │
│    engines.rs    engine adapters: claude · codex · opencode           │
│    control.rs    the A2A tunnel — local HTTP hub agents talk through  │
│    worktree.rs   git worktree isolation + merge-back                  │
│    workspace.rs  the workspace index and persisted state              │
└───────────┬───────────────────────────────────────────────────────────┘
            │ spawns
            ▼
   ┌──────────────┐   MCP over 127.0.0.1   ┌──────────────┐
   │  router      │◄──────────────────────►│  worker(s)   │
   │  (an agent)  │   spawn / message /    │  (agents)    │
   └──────────────┘   review / merge       └──────────────┘
```

## The core idea

There is no orchestration engine. **The router is just another agent** — a real `claude`/`codex`/`opencode` process in a real terminal. What makes it a router is a system prompt (its *role*) plus an MCP server that gives it tools: `spawn_worker`, `send_to_worker`, `review_worker`, `merge_worker`, `ask_user`, `save_memory`.

So "orchestration" is the router *choosing to call a tool*. We supply the plumbing; the model supplies the judgment. This is why the app stays small: there is no scheduler, no DAG, no state machine to maintain.

## The PTY layer (`lib.rs`)

Every agent is a real OS pseudo-terminal. `pty_spawn` opens one, runs the engine's command inside, and bridges it to xterm.js:

- **Reader → channel → flusher.** The reader thread blocks on the PTY; a flusher coalesces chunks over a ~25 ms window (or 32 KB) into a single `pty-output` event. Without this, several agents streaming at once flood the IPC and freeze the webview's main thread.
- **Output is base64.** Raw PTY bytes, not strings — mid-UTF-8 chunk boundaries would corrupt the stream otherwise.
- **`pty-exit` comes from a `child.wait()` thread, not from reader EOF.** On Windows/ConPTY the read does *not* return EOF when the agent exits; it only does when the PTY closes. Waiting on the process is the only portable way to know it died.
- **Agents get a sanitized environment (`env_clear` + whitelist).** Inheriting a full environment that was polluted by a parent `claude` session makes claude refuse to persist its transcript — which silently breaks `--resume`.

## The tunnel (`control.rs`)

A `tiny_http` server on `127.0.0.1:<random>`. The bundled MCP server (`desktop/agent/`) is handed to every agent, and its tools POST here.

**Delivery is a keystroke.** Routing a message to an agent means *typing it into its PTY* — there is no side channel. Two consequences that look like bugs but aren't:

- The Enter is sent as a **separate write, ~350 ms later**. Glued to the text, claude treats the whole thing as a paste and never submits it.
- If the target PTY is gone, `inject()` returns `false` and we **report the failure** to the sender instead of faking an ack.

The hub is **per-workspace**: a `router_id → cwd` map, not a global singleton. With several workspaces alive at once, a singleton router id would cross the wires. When a message is addressed to the literal `"router"`, we resolve it through the *sending worker's* `router_id` — that's the only way to know which workspace it meant.

## The agent's brain (`desktop/agent/`)

Three text layers, each with a different owner and a different moment. Nothing here is code — it's the prompt, and prompt is where an orchestrator actually lives.

| | what | who | when |
|---|---|---|---|
| **Role** (`*-role.md`) | who you are, your tools, how you work | router / worker | **always** — injected into the system prompt |
| **Playbook** (`playbooks/`) | how you *orchestrate* this kind of project | **router** | **on demand** (`load_playbook`) |
| **Skill** (`skills/`) | *domain* knowledge, for whoever does the work | **worker** | on demand (`spawn_worker({skills})`) |

**The worker cannot load a playbook, and that isn't stylistic.** A playbook contains the file split *between* workers. A worker that reads it knows which files belong to the others — which is exactly what makes a "helpful" worker touch someone else's file and blow up the merge. You'd be handing it the map of foreign territory and asking it not to step on it. The MCP's `ROLE === "router"` gate means it can't even see the tool.

Two failure modes worth knowing:

- **A missing playbook must be an explicit error, never empty text.** Silent absence reads as approval: the router would go on planning, convinced a playbook had backed it. `load_playbook` returns `{ok: false}` plus the list of valid names.
- **A skill name that doesn't exist is ignored silently** (`with_skills` is best-effort). So a playbook naming a skill that isn't installed launches a worker with *nothing*, and nobody finds out. Confirm names against `list_skills`.

Resources are packaged by `tauri.conf.json`'s `"resources": ["resources"]` — a **directory**, not a glob. `resources/*` doesn't recurse (subdirectories are skipped), so every new folder used to need its own line. Worse, `res_file` falls back to the crate's own `resources/` when a file isn't in the bundle, so a forgotten glob **worked fine in dev and broke only in the installer**. A directory pattern walks recursively and removes the trap.

And `build.rs` declares `rerun-if-changed=resources`. Without it, cargo doesn't re-run the build script when a role changes, the copy in `target/<profile>/resources/` goes stale, and **the app keeps injecting a role from days ago** — silently, with no error. (We shipped that bug for two days.)

## Engines (`engines.rs`)

Each engine gets a `LaunchSpec` (argv, env, session id, whether we must capture it). The differences that matter:

| | claude | codex | opencode |
|---|---|---|---|
| session id | we generate it (`--session-id`) | it generates one → **we scrape it** from `~/.codex/sessions` | same, from its storage dir |
| role injection | MCP config + system prompt | system prompt | `instructions` file in its config |
| task | positional arg | positional arg | **typed into the TUI** after boot (`inject_task`) |

`session_exists()` is what decides whether we can `--resume`. For claude it derives the transcript directory from the cwd by replacing separators with `-`. **This is why path normalization is load-bearing** — see below.

## Workspaces and persistence (`workspace.rs`)

Two invariants, both learned the hard way:

**1. `state_path()` is a pure function of the folder path.** All workspace state lives in `~/HyprDesk/state/<hash(folder)>.json`, whether the folder is one we created or one you linked. It never writes inside your repo.

> It used to decide *where* state lives by consulting the index at runtime. When that read failed, a linked workspace was treated as a managed one, its state was looked for in a file that didn't exist, and the workspace opened **empty — router gone, agents gone**. A state file cannot depend on another file to know where it lives.

**2. The index is a cache, not the source of truth.** Each state file carries its own `folder`, so `workspaces.json` can be rebuilt from scratch (`recover_index`). It is written **atomically** (temp + rename), a parse failure is never persisted, and every read-modify-write goes through a mutex.

> `fs::write` truncates. A concurrent reader saw an empty file, parsed it as `[]`, and a read-modify-write wrote that `[]` back. Result: the index on disk was destroyed while every workspace folder sat there intact.

### Path normalization (`paths.rs`)

`fs::canonicalize` on Windows returns the **verbatim form**: `\\?\E:\proj`. It is valid for the OS and poison for everything else, because nobody else uses it — Windows hands the *normalized* cwd to child processes, so claude writes its transcript to `~/.claude/projects/E--proj` while we were looking for `--?-E--proj`. `--resume` then failed silently and the agent came back with no memory.

**Normalize once, at the boundary** (`paths::strip_verbatim`). Never let a verbatim path into a string key.

## Worker isolation (`worktree.rs`)

In a git repo, each worker gets its own **worktree and branch** (`hyprdesk/<short-id>`) under `~/HyprDesk/.worktrees/`, so parallel workers can't collide. The router reviews a worker's diff (`review_worker`) and integrates it (`merge_worker`). Outside a git repo, workers just share the workspace folder.

When a worker's process dies we **mark it dead but keep its worktree** — its work is reviewable and mergeable. The worktree is only removed once a dead worker's branch has actually been merged. (An earlier version blew it away with `--force`: silent data loss.)

## The terminal (`src/terminal/keys.ts`)

Shift+Enter must insert a newline, not send the message. Two layers, neither OS-specific:

1. **The Kitty keyboard protocol.** xterm sends `\r` for both Enter and Shift+Enter — the modifier is lost. Claude, Codex and OpenCode all *enable* the protocol on startup without asking (`CSI < u`, `CSI > 1 u`), so once we speak it they receive a disambiguated `CSI 13;2u`. If an engine doesn't negotiate, we fall back to `ESC+CR`.
2. **`preventDefault()`.** xterm captures keys through a hidden `<textarea>`, and the browser *does* have a default action for Shift+Enter there: insert a line break. That phantom newline leaked through the textarea's `input` event and the agent read it as Enter. Ctrl+Enter worked all along precisely because it has no default — which is what gave the bug away.

## Where state lives on disk

```
~/HyprDesk/
  workspaces.json      the index (a cache — rebuildable, written atomically)
  state/<hash>.json    per-workspace state: tiles, session ids, profiles
  .memory/<hash>.md    the router's memory doc, re-injected when you reopen
  .worktrees/<hash>/   one isolated git worktree per worker
  <name>/              workspaces we created (linked folders stay where they are)
```
