// Tipos compartidos de la app (antes vivían en App.tsx, que era el hub de tipos).
import type { WorkspaceMeta } from "./WorkspaceManager";

export type Role = "router" | "worker";
export type TileKind = "terminal" | "file" | "browser";

export type Term = {
  id: string; title: string; role: Role; engine?: string; sessionId?: string;
  argv?: string[]; cwd?: string; env?: [string, string][]; injectTask?: string; captureEngine?: string;
  kind?: TileKind; filePath?: string; url?: string; // tiles no-terminal
  name?: string; color?: string; // agente de un perfil (nombre + color propios)
  branch?: string; // rama del worktree (repos git)
};

// Perfil de agente (por-workspace): describís → un meta-agente lo genera → lo lanzás.
export type Profile = {
  id: string; name: string; engine: string; model?: string; effort?: string;
  persona: string; color: string; rules?: { canMerge?: "always" | "ask" | "never" };
};

export type AgentLaunch = {
  agentId: string; engine: string; argv: string[]; env: [string, string][];
  injectTask: string | null; capture: boolean; sessionId: string | null; cwd: string; branch?: string | null;
};

export type Rect = { x: number; y: number; w: number; h: number };
export type SysStats = { cpu: number; mem_used: number; mem_total: number };
export type GlmUsage = { session?: number | null; weekly?: number | null };

export type SavedTile = { id: string; role: Role; engine: string; sessionId: string; title: string; kind?: TileKind; filePath?: string; url?: string; name?: string; color?: string; cwd?: string; branch?: string };
export type SavedState = { id: string; name: string; routerWidth: number; tiles: SavedTile[]; profiles?: Profile[] };
export type Stage = "workspaces" | "ide";
export type TileStatus = "working" | "idle" | "exited";
export type Panel = "agents" | "workspaces" | "files";

// Una sesión = un workspace ABIERTO. Con keep-alive tenemos varias vivas a la vez; todas sus
// tiles quedan montadas (PTYs vivos) y solo se muestra la actual (las demás con display:none).
export type WsSession = {
  meta: WorkspaceMeta;
  terms: Term[];
  routerId: string | null;
  activeId: string;
  routerWidth: number;
  maxId: string | null;
  needsRouter: boolean; // workspace nuevo sin router → mostramos el selector en el panel principal
  launchError: string | null;
  profiles: Profile[]; // perfiles de agentes de este workspace
};
