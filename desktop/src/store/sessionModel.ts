// Helpers puros del modelo de sesiones (sin estado): layout de la grilla y (de)serialización de tiles.
import type { AgentIdentity, AgentLaunch, Profile, Rect, Role, SavedState, Term, WsSession } from "../types";

export const MAX_TILES = 9;
export const HOSTS = ["dev@worker", "build@worker", "test@worker"];

// Convierte un AgentLaunch (del backend) en los campos de un tile.
export function tileFromLaunch(l: AgentLaunch, role: Role, title: string): Term {
  return {
    id: l.agentId, title, role, engine: l.engine,
    sessionId: l.sessionId ?? undefined, argv: l.argv, cwd: l.cwd, env: l.env,
    injectTask: l.injectTask ?? undefined, captureEngine: l.capture ? l.engine : undefined,
    branch: l.branch ?? undefined,
  };
}

// La identidad de un agente, tal como la espera el backend (spawn_profile_worker / worker_launch).
// Es lo que hace que un worker revivido vuelva CON su rol, y lo que muestra el panel de detalle.
export function identityOf(t: Term | Profile): AgentIdentity {
  const task = "task" in t ? t.task : undefined;
  return {
    name: t.name, model: t.model, effort: t.effort, persona: t.persona,
    task, skills: t.skills ?? [], color: t.color,
    profileId: "profileId" in t ? t.profileId : t.id,
  };
}

// Un agente con identidad se puede inspeccionar y guardar como perfil (lo haya creado el router o vos).
export function hasIdentity(t: Term): boolean {
  return !!(t.persona || t.task || t.model || t.effort || (t.skills && t.skills.length));
}

export function savedStateOf(s: WsSession): SavedState {
  return {
    id: s.meta.id, name: s.meta.name, routerWidth: s.routerWidth,
    tiles: s.terms
      // agentes (con sesión) + tiles de navegador (los de archivo/diff ya no se usan → fuera)
      .filter((x) => x.sessionId || x.kind === "browser")
      .map((x) => ({
        id: x.id, role: x.role, engine: x.engine ?? "claude", sessionId: x.sessionId ?? "", title: x.title,
        kind: x.kind, filePath: x.filePath, url: x.url, name: x.name, color: x.color,
        cwd: x.cwd, branch: x.branch, // R4: worktree/rama para restaurar al worker en su aislamiento
        // identidad: sin esto el agente revive sin persona ni skills (era AgentOpts::default()).
        persona: x.persona, model: x.model, effort: x.effort, task: x.task, skills: x.skills, profileId: x.profileId,
      })),
    profiles: s.profiles,
  };
}

// Reparte n workers en una grilla (coords 0-100). 1=full, 2=apilados, resto=cuadrícula.
export function computeLayout(n: number): Rect[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0, w: 100, h: 100 }];
  if (n === 2) return [{ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 50, w: 100, h: 50 }];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const itemsInRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const colInRow = i - row * cols;
    rects.push({ x: colInRow * (100 / itemsInRow), y: row * (100 / rows), w: 100 / itemsInRow, h: 100 / rows });
  }
  return rects;
}
