import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { TerminalTile } from "./TerminalTile";
import { CodeTile } from "./CodeTile";
import { BrowserTile } from "./BrowserTile";
import { FilesPanel } from "./FilesPanel";
import { ChangesPanel, type WsChanges, type GitEntry } from "./ChangesPanel";
import { SettingsModal } from "./SettingsModal";
import { CreateAgentModal } from "./CreateAgentModal";
import { WorkspaceManager, type WorkspaceMeta } from "./WorkspaceManager";
import { Sidebar } from "./Sidebar";
import { WorkspacesPanel } from "./WorkspacesPanel";
import { CommandPalette, type Command } from "./CommandPalette";

const HOSTS = ["dev@worker", "build@worker", "test@worker"];
const MAX_TILES = 9;

type Role = "router" | "worker";
type TileKind = "terminal" | "file" | "diff" | "browser";
type Term = {
  id: string; title: string; role: Role; engine?: string; sessionId?: string;
  argv?: string[]; cwd?: string; env?: [string, string][]; injectTask?: string; captureEngine?: string;
  kind?: TileKind; filePath?: string; url?: string; diff?: { old: string; new: string }; // tiles no-terminal
  name?: string; color?: string; // agente de un perfil (nombre + color propios)
};
// Perfil de agente (por-workspace): describís → un meta-agente lo genera → lo lanzás.
export type Profile = {
  id: string; name: string; engine: string; model?: string; effort?: string;
  persona: string; color: string; rules?: { canMerge?: "always" | "ask" | "never" };
};
type AgentLaunch = {
  agentId: string; engine: string; argv: string[]; env: [string, string][];
  injectTask: string | null; capture: boolean; sessionId: string | null; cwd: string;
};
type Rect = { x: number; y: number; w: number; h: number };
type SysStats = { cpu: number; mem_used: number; mem_total: number };
type SavedTile = { id: string; role: Role; engine: string; sessionId: string; title: string; kind?: TileKind; filePath?: string; url?: string; name?: string; color?: string };
type SavedState = { id: string; name: string; routerWidth: number; tiles: SavedTile[]; profiles?: Profile[] };
type Stage = "workspaces" | "ide";

// Una sesión = un workspace ABIERTO. Con keep-alive tenemos varias vivas a la vez; todas sus
// tiles quedan montadas (PTYs vivos) y solo se muestra la actual (las demás con display:none).
type WsSession = {
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

// Convierte un AgentLaunch (del backend) en los campos de un tile.
function tileFromLaunch(l: AgentLaunch, role: Role, title: string): Term {
  return {
    id: l.agentId, title, role, engine: l.engine,
    sessionId: l.sessionId ?? undefined, argv: l.argv, cwd: l.cwd, env: l.env,
    injectTask: l.injectTask ?? undefined, captureEngine: l.capture ? l.engine : undefined,
  };
}

function savedStateOf(s: WsSession): SavedState {
  return {
    id: s.meta.id, name: s.meta.name, routerWidth: s.routerWidth,
    tiles: s.terms
      // agentes (con sesión) + tiles de archivo/navegador (los diff son transitorios → fuera)
      .filter((x) => x.sessionId || x.kind === "file" || x.kind === "browser")
      .map((x) => ({
        id: x.id, role: x.role, engine: x.engine ?? "claude", sessionId: x.sessionId ?? "", title: x.title,
        kind: x.kind, filePath: x.filePath, url: x.url, name: x.name, color: x.color,
      })),
    profiles: s.profiles,
  };
}

function computeLayout(n: number): Rect[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0, w: 100, h: 100 }];
  // 2 workers: apilados en UNA columna (router | worker/worker), no 3 columnas.
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

const gib = (b: number) => (b / 1024 ** 3).toFixed(1);
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`);

function App() {
  const [stage, setStage] = useState<Stage>("workspaces");
  const [sessions, setSessions] = useState<WsSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null); // meta.id del workspace visible
  const [closing, setClosing] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [stats, setStats] = useState<SysStats | null>(null);
  const [usage, setUsage] = useState<{ tokens: number; messages: number } | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]); // tiles con mensaje sin leer (parpadeo), global
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [panel, setPanel] = useState<"agents" | "workspaces" | "files" | "changes">("agents");
  const [changesByWs, setChangesByWs] = useState<Record<string, WsChanges>>({}); // por carpeta de workspace
  const gitTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [previewsByWs, setPreviewsByWs] = useState<Record<string, string[]>>({}); // localhost URLs detectadas

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const menuActionRef = useRef<(action: string) => void>(() => {}); // handlers del menú nativo (frescos por render)

  const current = sessions.find((s) => s.meta.id === currentId) ?? null;
  const currentActiveId = current?.activeId ?? "";

  // Muta una sesión por id.
  const updateSession = useCallback((wsId: string, fn: (s: WsSession) => WsSession) => {
    setSessions((prev) => prev.map((s) => (s.meta.id === wsId ? fn(s) : s)));
  }, []);
  // Muta la sesión ACTUAL (para handlers de teclado/eventos).
  const updateCurrent = useCallback((fn: (s: WsSession) => WsSession) => {
    const id = currentIdRef.current;
    if (id) setSessions((prev) => prev.map((s) => (s.meta.id === id ? fn(s) : s)));
  }, []);

  // ---- stats reales ----
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const s = await invoke<SysStats>("system_stats"); if (alive) setStats(s); } catch { /**/ }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // ---- consumo de tokens de Claude HOY (refresca cada 60s) ----
  useEffect(() => {
    let alive = true;
    const tick = () => invoke<{ tokens: number; messages: number }>("usage_today").then((u) => { if (alive) setUsage(u); }).catch(() => {});
    tick();
    const iv = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // ---- rama git del workspace actual (para el header) ----
  useEffect(() => {
    const folder = sessions.find((s) => s.meta.id === currentId)?.meta.folder;
    if (!folder) { setBranch(null); return; }
    invoke<string | null>("git_branch", { cwd: folder }).then((b) => setBranch(b)).catch(() => setBranch(null));
  }, [currentId, changesByWs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- eventos del backend (spawn de workers, session-id capturado, actividad del túnel) ----
  useEffect(() => {
    let un: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    let un4: (() => void) | undefined;
    let un5: (() => void) | undefined;
    (async () => {
      // el router pidió spawnear un worker → lo asignamos a la sesión de ESE router (payload.router).
      un = await listen<AgentLaunch & { title: string; router: string }>("spawn-agent", (e) => {
        const t = tileFromLaunch(e.payload, "worker", e.payload.title);
        const routerAgentId = e.payload.router;
        setSessions((prev) => prev.map((s) => {
          if (s.routerId !== routerAgentId) return s;
          if (s.terms.length >= MAX_TILES) return s;
          return { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null };
        }));
        // registrar en el roster del hub (para list_workers)
        invoke("register_worker", { id: t.id, engine: e.payload.engine, name: e.payload.title, routerId: routerAgentId, cwd: e.payload.cwd }).catch(() => {});
      });
      // session-id capturado de codex/opencode → completar el tile (para persistir), en cualquier sesión.
      un2 = await listen<{ agentId: string; sessionId: string }>("agent-session", (e) => {
        setSessions((prev) => prev.map((s) => ({
          ...s,
          terms: s.terms.map((t) => (t.id === e.payload.agentId ? { ...t, sessionId: e.payload.sessionId } : t)),
        })));
      });
      // un agente recibió un mensaje del túnel → marcar su tile con actividad (parpadeo).
      un3 = await listen<string>("tile-activity", (e) => {
        setActivity((a) => (a.includes(e.payload) ? a : [...a, e.payload]));
      });
      // un archivo del workspace cambió → acumular en "watched" + refrescar git status (debounce).
      un4 = await listen<{ path: string; kind: string; root: string }>("file-changed", (e) => {
        const { path, kind, root } = e.payload;
        setChangesByWs((prev) => {
          const cur = prev[root] ?? { git: [], watched: [] };
          const watched = [{ path, kind }, ...cur.watched.filter((w) => w.path !== path)].slice(0, 200);
          return { ...prev, [root]: { git: cur.git, watched } };
        });
        clearTimeout(gitTimersRef.current[root]);
        gitTimersRef.current[root] = setTimeout(async () => {
          try {
            const git = await invoke<GitEntry[]>("git_status", { cwd: root });
            setChangesByWs((prev) => ({ ...prev, [root]: { git, watched: prev[root]?.watched ?? [] } }));
          } catch { /* no repo */ }
        }, 400);
      });
      // un PTY murió → sacar ese worker del roster (list_workers refleja solo vivos).
      un5 = await listen<string>("pty-exit", (e) => {
        invoke("unregister_worker", { id: e.payload }).catch(() => {});
      });
    })();
    return () => { un?.(); un2?.(); un3?.(); un4?.(); un5?.(); };
  }, []);

  // Limpiar la actividad del tile que se enfoca (en la sesión actual).
  useEffect(() => {
    if (currentActiveId) setActivity((a) => (a.includes(currentActiveId) ? a.filter((x) => x !== currentActiveId) : a));
  }, [currentActiveId]);

  // ---- menú nativo: el backend emite "menu"<action> → ejecutamos el handler fresco ----
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<string>("menu", (e) => menuActionRef.current(e.payload)).then((u) => { un = u; });
    return () => un?.();
  }, []);

  // ---- mantener el cwd "activo" del backend apuntando al workspace visible (fallback del túnel) ----
  useEffect(() => {
    if (current) invoke("set_active_workspace", { folder: current.meta.folder }).catch(() => {});
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- auto-guardar el estado de cada sesión abierta (debounce) ----
  useEffect(() => {
    if (stage !== "ide") return;
    const t = setTimeout(() => {
      for (const s of sessionsRef.current) {
        if (s.needsRouter) continue;
        invoke("save_workspace", { folder: s.meta.folder, state: JSON.stringify(savedStateOf(s)) }).catch(() => {});
      }
    }, 500);
    return () => clearTimeout(t);
  }, [sessions, stage]);

  // Si se cerró la última sesión, volvemos al gestor full-screen.
  useEffect(() => {
    if (stage === "ide" && sessions.length === 0) setStage("workspaces");
  }, [sessions, stage]);

  // ---- construir una sesión restaurada (revive router + workers con --resume) ----
  const buildRestoredSession = async (meta: WorkspaceMeta, saved: SavedState): Promise<WsSession> => {
    const next: Term[] = [];
    let rId: string | null = null;
    let err: string | null = null;
    const routerTile = saved.tiles.find((t) => t.role === "router");
    if (routerTile) {
      try {
        const r = await invoke<AgentLaunch>("router_launch", {
          engine: routerTile.engine || "claude", cwd: meta.folder, resumeSession: routerTile.sessionId,
        });
        next.push(tileFromLaunch(r, "router", routerTile.title || `router · ${routerTile.engine}`));
        rId = r.agentId;
      } catch (e) { err = String(e); }
    }
    // workers agentes (con sesión): revivir con --resume
    for (const t of saved.tiles.filter((x) => x.role === "worker" && (!x.kind || x.kind === "terminal") && x.sessionId)) {
      try {
        const w = await invoke<AgentLaunch>("worker_launch", {
          engine: t.engine || "claude", agentId: t.id, sessionId: t.sessionId, cwd: meta.folder, routerId: rId || "router",
        });
        const wt = tileFromLaunch(w, "worker", t.title || `worker · ${t.engine}`);
        wt.name = t.name; wt.color = t.color; // conservar nombre/color del perfil
        next.push(wt);
        invoke("register_worker", { id: w.agentId, engine: t.engine || "claude", name: t.name || t.title, routerId: rId || "router", cwd: meta.folder }).catch(() => {});
      } catch { /* worker que no resume, lo salteamos */ }
    }
    // tiles de archivo/navegador: recrear sin lanzar procesos
    for (const t of saved.tiles.filter((x) => x.kind === "file" || x.kind === "browser")) {
      next.push({ id: t.id, title: t.title, role: "worker", kind: t.kind, filePath: t.filePath, url: t.url });
    }
    return {
      meta, terms: next, routerId: rId, activeId: rId || next[0]?.id || "",
      routerWidth: saved.routerWidth || 50, maxId: null, needsRouter: !routerTile, launchError: err,
      profiles: saved.profiles ?? [],
    };
  };

  // ---- abrir un workspace: si ya está abierto → switch instantáneo; si no → crear sesión ----
  const openWorkspace = async (meta: WorkspaceMeta) => {
    if (sessionsRef.current.some((s) => s.meta.id === meta.id)) {
      setCurrentId(meta.id);
      setStage("ide");
      return;
    }
    invoke("touch_workspace", { id: meta.id }).catch(() => {});
    let saved: SavedState | null = null;
    try {
      const s = await invoke<string | null>("load_workspace", { folder: meta.folder });
      saved = s ? JSON.parse(s) : null;
    } catch { /* sin estado */ }
    const session: WsSession = (saved && saved.tiles?.length)
      ? await buildRestoredSession(meta, saved)
      : { meta, terms: [], routerId: null, activeId: "", routerWidth: 50, maxId: null, needsRouter: true, launchError: null, profiles: saved?.profiles ?? [] };
    setSessions((prev) => [...prev.filter((s) => s.meta.id !== meta.id), session]);
    setCurrentId(meta.id);
    setStage("ide");
    startWatching(meta.folder);
  };

  // Vigila la carpeta del workspace (watcher) y carga el git status inicial.
  const startWatching = useCallback((folder: string) => {
    invoke("watch_workspace", { folder }).catch(() => {});
    invoke<GitEntry[]>("git_status", { cwd: folder })
      .then((git) => setChangesByWs((prev) => ({ ...prev, [folder]: { git, watched: prev[folder]?.watched ?? [] } })))
      .catch(() => {});
  }, []);

  // ---- crear el router de la sesión actual (workspace nuevo) ----
  const startRouter = async (engine: string) => {
    const cur = sessionsRef.current.find((s) => s.meta.id === currentIdRef.current);
    if (!cur) return;
    try {
      const r = await invoke<AgentLaunch>("router_launch", { engine, cwd: cur.meta.folder, resumeSession: null });
      updateSession(cur.meta.id, (s) => ({
        ...s, terms: [tileFromLaunch(r, "router", `router · ${engine}`)],
        routerId: r.agentId, activeId: r.agentId, needsRouter: false, launchError: null,
      }));
    } catch (e) {
      updateSession(cur.meta.id, (s) => ({ ...s, launchError: String(e) }));
    }
  };

  // ---- cerrar una sesión (tab): guarda y desmonta sus tiles (mata sus PTYs) ----
  const closeWorkspace = async (wsId: string) => {
    const s = sessionsRef.current.find((x) => x.meta.id === wsId);
    if (s && !s.needsRouter) {
      await invoke("save_workspace", { folder: s.meta.folder, state: JSON.stringify(savedStateOf(s)) }).catch(() => {});
    }
    if (s) {
      invoke("unwatch_workspace", { folder: s.meta.folder }).catch(() => {});
      setChangesByWs((prev) => { const n = { ...prev }; delete n[s.meta.folder]; return n; });
    }
    const rest = sessionsRef.current.filter((x) => x.meta.id !== wsId);
    setSessions(rest);
    if (currentIdRef.current === wsId) setCurrentId(rest[0]?.meta.id ?? null);
  };

  // ---- terminal manual (⌘T): shell, no es agente, no se persiste (en la sesión actual) ----
  const addTerminal = useCallback(() => {
    const t: Term = { id: crypto.randomUUID(), title: HOSTS[Math.floor(Math.random() * HOSTS.length)], role: "worker" };
    updateCurrent((s) => (s.terms.length >= MAX_TILES ? s : { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null }));
  }, [updateCurrent]);

  const setActive = useCallback((id: string) => {
    updateCurrent((s) => ({ ...s, activeId: id }));
  }, [updateCurrent]);

  // Abre (o enfoca) un tile de archivo con CodeMirror (visor/editor) en la sesión actual.
  const openFile = useCallback((path: string) => {
    const name = path.split("/").pop() || path;
    updateCurrent((s) => {
      const existing = s.terms.find((t) => t.kind === "file" && t.filePath === path);
      if (existing) return { ...s, activeId: existing.id };
      if (s.terms.length >= MAX_TILES) return s;
      const t: Term = { id: crypto.randomUUID(), title: name, role: "worker", kind: "file", filePath: path };
      return { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null };
    });
  }, [updateCurrent]);

  // Abre un tile de diff (old=HEAD, new=disco) para un archivo repo-relativo del workspace actual.
  const openDiff = useCallback(async (relPath: string) => {
    const cur = sessionsRef.current.find((s) => s.meta.id === currentIdRef.current);
    if (!cur) return;
    try {
      const d = await invoke<{ old: string; new: string }>("git_diff", { cwd: cur.meta.folder, path: relPath });
      const name = relPath.split("/").pop() || relPath;
      updateCurrent((s) => {
        if (s.terms.length >= MAX_TILES) return s;
        const t: Term = { id: crypto.randomUUID(), title: `Δ ${name}`, role: "worker", kind: "diff", filePath: `${cur.meta.folder}/${relPath}`, diff: d };
        return { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null };
      });
    } catch { /* sin diff */ }
  }, [updateCurrent]);

  // Abre (o enfoca) un tile navegador con una URL (localhost detectado, file://, o vacío).
  const openBrowser = useCallback((url?: string) => {
    updateCurrent((s) => {
      if (url) {
        const existing = s.terms.find((t) => t.kind === "browser" && t.url === url);
        if (existing) return { ...s, activeId: existing.id };
      }
      if (s.terms.length >= MAX_TILES) return s;
      let title = "navegador";
      try { if (url) title = new URL(url).host || url; } catch { if (url) title = url; }
      const t: Term = { id: crypto.randomUUID(), title, role: "worker", kind: "browser", url };
      return { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null };
    });
  }, [updateCurrent]);

  // ---- perfiles de agentes (por-workspace) ----
  const saveProfile = useCallback((profile: Profile) => {
    updateCurrent((s) => {
      const exists = s.profiles.some((p) => p.id === profile.id);
      const profiles = exists ? s.profiles.map((p) => (p.id === profile.id ? profile : p)) : [...s.profiles, profile];
      return { ...s, profiles };
    });
  }, [updateCurrent]);

  const deleteProfile = useCallback((id: string) => {
    updateCurrent((s) => ({ ...s, profiles: s.profiles.filter((p) => p.id !== id) }));
  }, [updateCurrent]);

  // Lanza un worker desde un perfil (reporta al router actual del workspace).
  const launchProfile = useCallback(async (profile: Profile, task?: string) => {
    const cur = sessionsRef.current.find((s) => s.meta.id === currentIdRef.current);
    if (!cur || !cur.routerId) return;
    try {
      const l = await invoke<AgentLaunch>("spawn_profile_worker", {
        engine: profile.engine, cwd: cur.meta.folder, routerId: cur.routerId,
        model: profile.model || null, effort: profile.effort || null, persona: profile.persona || null, task: task || null,
      });
      const t = tileFromLaunch(l, "worker", profile.name);
      t.name = profile.name; t.color = profile.color;
      updateCurrent((s) => (s.terms.length >= MAX_TILES ? s : { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null }));
      invoke("register_worker", { id: l.agentId, engine: profile.engine, name: profile.name, routerId: cur.routerId, cwd: cur.meta.folder }).catch(() => {});
    } catch { /* error de lanzamiento */ }
  }, [updateCurrent]);

  // Registra una URL localhost detectada en la salida de un tile (dedupe, por workspace).
  const addPreview = useCallback((folder: string, url: string) => {
    setPreviewsByWs((prev) => {
      const list = prev[folder] ?? [];
      if (list.includes(url)) return prev;
      return { ...prev, [folder]: [url, ...list].slice(0, 6) };
    });
  }, []);

  const closeTerminal = useCallback((id: string) => {
    const cur = sessionsRef.current.find((s) => s.meta.id === currentIdRef.current);
    if (!cur) return;
    const t = cur.terms.find((x) => x.id === id);
    if (!t || t.role === "router") return;
    if (t.sessionId || t.name) invoke("unregister_worker", { id }).catch(() => {}); // sacar del roster si era agente
    updateCurrent((s) => {
      if (s.activeId !== id) return s;
      const idx = s.terms.findIndex((x) => x.id === id);
      const nextActive = s.terms[idx + 1]?.id ?? s.terms[idx - 1]?.id ?? s.terms[0]?.id ?? "";
      return { ...s, activeId: nextActive };
    });
    setClosing((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, [updateCurrent]);

  const toggleMax = useCallback((id: string) => {
    updateCurrent((s) => ({ ...s, maxId: s.maxId === id ? null : id }));
  }, [updateCurrent]);

  // Anima el cierre y luego remueve el tile de su sesión.
  useEffect(() => {
    if (closing.length === 0) return;
    const timers = closing.map((id) =>
      setTimeout(() => {
        setSessions((prev) => prev.map((s) => ({
          ...s,
          terms: s.terms.filter((t) => t.id !== id),
          maxId: s.maxId === id ? null : s.maxId,
        })));
        setClosing((prev) => prev.filter((x) => x !== id));
      }, 200)
    );
    return () => timers.forEach(clearTimeout);
  }, [closing]);

  // Si el tile activo desapareció, caer al router de esa sesión.
  useEffect(() => {
    if (!current) return;
    if (current.routerId && !current.terms.find((t) => t.id === current.activeId)) {
      updateSession(current.meta.id, (s) => ({ ...s, activeId: s.routerId || s.terms[0]?.id || "" }));
    }
  }, [current, updateSession]);

  const focusDelta = (d: number) => {
    const cur = sessionsRef.current.find((s) => s.meta.id === currentIdRef.current);
    if (!cur) return;
    const idx = cur.terms.findIndex((t) => t.id === cur.activeId);
    if (idx < 0) return;
    setActive(cur.terms[(idx + d + cur.terms.length) % cur.terms.length].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stage !== "ide") return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); e.stopPropagation(); addTerminal(); }
      else if (k === "w") { e.preventDefault(); e.stopPropagation(); const a = current?.activeId; if (a) closeTerminal(a); }
      else if (k === "k") { e.preventDefault(); e.stopPropagation(); setPaletteOpen((o) => !o); }
      else if (k === "b") { e.preventDefault(); e.stopPropagation(); setSidebarOpen((o) => !o); }
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusDelta(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusDelta(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTerminal, closeTerminal, stage, currentActiveId]);

  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    const ws = (e.currentTarget as HTMLElement).closest(".workspace") as HTMLElement | null;
    const wsId = currentIdRef.current;
    if (!ws || !wsId) return;
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const rect = ws.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      updateSession(wsId, (s) => ({ ...s, routerWidth: Math.max(28, Math.min(78, pct)) }));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Handler del menú nativo (reasignado cada render → captura los closures actuales).
  menuActionRef.current = (action: string) => {
    switch (action) {
      case "new-workspace": setPanel("workspaces"); setSidebarOpen(true); break;
      case "open-folder":
        open({ directory: true, multiple: false, title: "Abrir carpeta como workspace" })
          .then((picked) => (picked && typeof picked === "string"
            ? invoke<WorkspaceMeta>("link_workspace", { folder: picked }) : undefined))
          .then((meta) => { if (meta) openWorkspace(meta); })
          .catch(() => {});
        break;
      case "close-workspace": if (currentId) closeWorkspace(currentId); break;
      case "toggle-sidebar": setSidebarOpen((o) => !o); break;
      case "palette": setPaletteOpen((o) => !o); break;
      case "settings": setSettingsOpen(true); break;
    }
  };

  // ---- pantalla: gestor de workspaces (estado vacío / inicial) ----
  if (stage === "workspaces") {
    return (
      <>
        <WorkspaceManager onOpen={openWorkspace} />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </>
    );
  }

  // ---- render de la grilla de UNA sesión (montada siempre; visible solo la actual) ----
  const renderGrid = (s: WsSession) => {
    const workers = s.terms.filter((t) => t.role === "worker");
    const workerRects = computeLayout(workers.length);
    const hasWorkers = workers.length > 0;
    const isCurrent = s.meta.id === currentId;

    const slotStyle = (t: Term): CSSProperties => {
      if (s.maxId != null) {
        return s.maxId === t.id
          ? { left: "0%", top: "0%", width: "100%", height: "100%", zIndex: 5 }
          : { left: "0%", top: "0%", width: "100%", height: "100%", opacity: 0, pointerEvents: "none" };
      }
      if (!hasWorkers) return { left: "0%", top: "0%", width: "100%", height: "100%" };
      if (t.role === "router") return { left: "0%", top: "0%", width: `${s.routerWidth}%`, height: "100%" };
      const wi = workers.findIndex((w) => w.id === t.id);
      const r = workerRects[wi] ?? { x: 0, y: 0, w: 100, h: 100 };
      const rw = 100 - s.routerWidth;
      return { left: `${s.routerWidth + (r.x * rw) / 100}%`, top: `${r.y}%`, width: `${(r.w * rw) / 100}%`, height: `${r.h}%` };
    };

    return (
      <div className={`workspace ${dragging && isCurrent ? "workspace--dragging" : ""}`}>
        {s.terms.map((t) => (
          <div className={`slot ${closing.includes(t.id) ? "slot--closing" : ""}`} key={t.id} style={slotStyle(t)}>
            {t.kind === "file" || t.kind === "diff" ? (
              <CodeTile
                id={t.id}
                title={t.title}
                active={s.activeId === t.id}
                canClose={t.role === "worker"}
                maximized={s.maxId === t.id}
                filePath={t.filePath}
                diff={t.diff}
                onFocus={setActive}
                onClose={closeTerminal}
                onToggleMax={toggleMax}
              />
            ) : t.kind === "browser" ? (
              <BrowserTile
                id={t.id}
                title={t.title}
                active={s.activeId === t.id}
                canClose={t.role === "worker"}
                maximized={s.maxId === t.id}
                url={t.url}
                onFocus={setActive}
                onClose={closeTerminal}
                onToggleMax={toggleMax}
              />
            ) : (
              <TerminalTile
                id={t.id}
                title={t.title}
                active={s.activeId === t.id}
                isRouter={t.role === "router"}
                canClose={t.role === "worker"}
                maximized={s.maxId === t.id}
                argv={t.argv}
                cwd={t.cwd}
                env={t.env}
                injectTask={t.injectTask}
                captureEngine={t.captureEngine}
                hasActivity={activity.includes(t.id)}
                color={t.color}
                onFocus={setActive}
                onClose={closeTerminal}
                onToggleMax={toggleMax}
                onDetectUrl={(url) => addPreview(s.meta.folder, url)}
              />
            )}
          </div>
        ))}

        {hasWorkers && s.maxId == null && (
          <div className="divider" style={{ left: `${s.routerWidth}%` }} onMouseDown={startDrag} title="Arrastrá para ajustar el router" />
        )}

        <button className="fab" title="Terminal manual (⌘T)" onClick={addTerminal}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  };

  // ---- selector de agente para una sesión nueva (sin router) ----
  const renderSelector = (s: WsSession) => (
    <div className="selector selector--inline">
      <div className="selector__card">
        <div className="selector__brand">🧭 {s.meta.name}</div>
        <div className="selector__title">Elegí tu agente router</div>
        <div className="selector__sub">Vas a hablar con él; delega workers reales por vos.</div>
        <div className="selector__agents">
          <button className="agent-btn" onClick={() => startRouter("claude")}>
            <span className="agent-btn__name">Claude Code</span>
            <span className="agent-btn__go">Iniciar →</span>
          </button>
          <button className="agent-btn" onClick={() => startRouter("codex")}>
            <span className="agent-btn__name">Codex</span>
            <span className="agent-btn__go">Iniciar →</span>
          </button>
          <button className="agent-btn" onClick={() => startRouter("opencode")}>
            <span className="agent-btn__name">OpenCode</span>
            <span className="agent-btn__go">Iniciar →</span>
          </button>
        </div>
        <button className="selector__back" onClick={() => closeWorkspace(s.meta.id)}>← cerrar este workspace</button>
        {s.launchError && <div className="selector__error">{s.launchError}</div>}
      </div>
    </div>
  );

  // ---- pantalla: IDE (shell) ----
  const workers = current ? current.terms.filter((t) => t.role === "worker") : [];
  const agents = current ? current.terms.map((t) => ({ id: t.id, title: t.title, role: t.role, engine: t.engine, color: t.color })) : [];
  const curChanges = current ? changesByWs[current.meta.folder] : undefined;
  const changeCount = curChanges ? (curChanges.git.length || curChanges.watched.length) : 0;
  const curPreviews = current ? previewsByWs[current.meta.folder] ?? [] : [];
  const commands: Command[] = [
    { id: "new-term", label: "Nueva terminal manual", hint: "⌘T", run: addTerminal },
    { id: "close", label: "Cerrar tile activo", hint: "⌘W", run: () => { if (current?.activeId) closeTerminal(current.activeId); } },
    { id: "max", label: "Maximizar / restaurar activo", run: () => { if (current?.activeId) toggleMax(current.activeId); } },
    { id: "focus-router", label: "Ir al router", run: () => { if (current?.routerId) setActive(current.routerId); } },
    { id: "files", label: "Explorador de archivos", run: () => { setPanel("files"); setSidebarOpen(true); } },
    { id: "changes", label: "Cambios (archivos modificados)", run: () => { setPanel("changes"); setSidebarOpen(true); } },
    { id: "browser", label: "Nuevo navegador / preview", run: () => openBrowser() },
    { id: "settings", label: "Configuración", hint: "⌘,", run: () => setSettingsOpen(true) },
    { id: "sidebar", label: "Mostrar / ocultar panel", hint: "⌘B", run: () => setSidebarOpen((o) => !o) },
    { id: "close-ws", label: "Cerrar este workspace", run: () => { if (currentId) closeWorkspace(currentId); } },
    { id: "workspaces", label: "Panel de workspaces", run: () => { setPanel("workspaces"); setSidebarOpen(true); } },
  ];

  return (
    <div className="ide">
      <div className="titlebar">
        <div className="titlebar__side">
          <span className="stat"><span className="stat__k">CPU</span><span className="stat__v">{stats ? `${Math.round(stats.cpu)}%` : "—"}</span></span>
          <span className="stat"><span className="stat__k">RAM</span><span className="stat__v">{stats ? `${gib(stats.mem_used)}/${gib(stats.mem_total)}G` : "—"}</span></span>
          {usage && usage.tokens > 0 && (
            <span className="stat stat--usage" title={`${usage.messages} mensajes de Claude hoy`}>
              <span className="stat__k">Claude</span><span className="stat__v">{fmtTok(usage.tokens)} tok</span>
            </span>
          )}
        </div>
        <div className="titlebar__title">
          <span className="titlebar__app">HyprDesk</span>
          <span className="titlebar__sep">·</span>
          <span className="titlebar__ws">{current?.meta.name ?? ""}</span>
          {branch && <span className="titlebar__branch" title="rama git"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.3" /><path d="M4 5.6v4.8M5.6 4h3.2a2 2 0 012 2v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>{branch}</span>}
        </div>
        <div className="titlebar__side titlebar__side--right">
          <span className="stat stat--live" title="agentes / tiles"><span className="dot" /> {current?.terms.length ?? 0}</span>
          <button className="titlebar__cmd" onClick={() => setPaletteOpen(true)}>Comandos <kbd>⌘K</kbd></button>
        </div>
      </div>

      {/* tabs de workspaces abiertos (keep-alive) */}
      <div className="wstabs">
        {sessions.map((s) => (
          <div key={s.meta.id} className={`wstab ${s.meta.id === currentId ? "wstab--active" : ""}`} onClick={() => setCurrentId(s.meta.id)}>
            <span className="wstab__dot" />
            <span className="wstab__name">{s.meta.name}</span>
            <button className="wstab__close" title="Cerrar workspace" onClick={(e) => { e.stopPropagation(); closeWorkspace(s.meta.id); }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
          </div>
        ))}
      </div>

      <div className="ide__body">
        <div className="activitybar">
          <button className={`act ${sidebarOpen && panel === "workspaces" ? "act--on" : ""}`} title="Workspaces" onClick={() => { setPanel("workspaces"); setSidebarOpen(true); }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 6.5A1.5 1.5 0 014.5 5H8l1.8 1.8H15.5A1.5 1.5 0 0117 8.3v6.2A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5v-8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </button>
          <button className={`act ${sidebarOpen && panel === "agents" ? "act--on" : ""}`} title="Agentes (⌘B)" onClick={() => { setPanel("agents"); setSidebarOpen(true); }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button className={`act ${sidebarOpen && panel === "files" ? "act--on" : ""}`} title="Archivos" onClick={() => { setPanel("files"); setSidebarOpen(true); }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M11 3H5.5A1.5 1.5 0 004 4.5v11A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V8l-5-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M11 3v4.5H16" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </button>
          <button className={`act ${sidebarOpen && panel === "changes" ? "act--on" : ""}`} title="Cambios" onClick={() => { setPanel("changes"); setSidebarOpen(true); }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" /><circle cx="6" cy="15" r="2.2" stroke="currentColor" strokeWidth="1.4" /><circle cx="14" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" /><path d="M6 8.2v4.6M14 8.2c0 3-2.5 4-4.5 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            {changeCount > 0 && <span className="act__badge">{changeCount > 99 ? "99+" : changeCount}</span>}
          </button>
          <button className="act" title="Comandos (⌘K)" onClick={() => setPaletteOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button className="act act--bottom" title="Configuración (⌘,)" onClick={() => setSettingsOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        </div>

        {sidebarOpen && (
          panel === "workspaces"
            ? <WorkspacesPanel activeId={currentId ?? undefined} onSwitch={openWorkspace} />
            : panel === "files"
              ? <FilesPanel root={current?.meta.folder ?? null} onOpenFile={openFile} onPreview={(p) => openBrowser("file://" + p)} />
              : panel === "changes"
                ? <ChangesPanel changes={curChanges} root={current?.meta.folder ?? null} onOpenDiff={openDiff} onOpenFile={openFile} />
                : <Sidebar
                    agents={agents} activeId={currentActiveId} activity={activity}
                    profiles={current?.profiles ?? []}
                    onFocus={setActive} onNewTerminal={addTerminal}
                    onLaunchProfile={(p) => launchProfile(p)}
                    onCreateAgent={() => setCreateAgentOpen(true)}
                    onDeleteProfile={deleteProfile}
                  />
        )}

        <div className="main">
          {/* todas las sesiones montadas (PTYs vivos); solo la actual visible → switch sin costo */}
          {sessions.map((s) => (
            <div key={s.meta.id} className="wsview" style={{ display: s.meta.id === currentId ? "flex" : "none" }}>
              {s.needsRouter ? renderSelector(s) : renderGrid(s)}
            </div>
          ))}
        </div>
      </div>

      <div className="statusbar">
        <span className="statusbar__role">
          <span className="dot dot--router" /> {workers.length} worker{workers.length !== 1 ? "s" : ""} · {sessions.length} ws
          {changeCount > 0 && (
            <button className="statusbar__changes" title="Ver cambios" onClick={() => { setPanel("changes"); setSidebarOpen(true); }}>
              <span className="statusbar__changes-dot" /> {changeCount} cambio{changeCount !== 1 ? "s" : ""}
            </button>
          )}
          {curPreviews.slice(0, 3).map((u) => {
            let port = ""; try { port = new URL(u).port || new URL(u).host; } catch { port = u; }
            return (
              <button key={u} className="statusbar__preview" title={`Abrir preview: ${u}`} onClick={() => openBrowser(u)}>
                <span className="statusbar__preview-dot" /> :{port}
              </button>
            );
          })}
        </span>
        <span className="statusbar__keys"><kbd>⌘K</kbd> comandos · <kbd>⌘B</kbd> panel · <kbd>⌘T</kbd> terminal · <kbd>⌘←→</kbd> foco</span>
        <span className="statusbar__hint">Pedile al router que haga algo — él delega workers</span>
      </div>

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {createAgentOpen && (
        <CreateAgentModal
          canLaunch={!!current?.routerId}
          onClose={() => setCreateAgentOpen(false)}
          onSave={(p) => saveProfile(p)}
          onSaveAndLaunch={(p) => { saveProfile(p); launchProfile(p); }}
        />
      )}
    </div>
  );
}

export default App;
