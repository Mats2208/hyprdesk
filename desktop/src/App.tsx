import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalTile } from "./TerminalTile";
import { WorkspaceManager, type WorkspaceMeta } from "./WorkspaceManager";

const HOSTS = ["dev@worker", "build@worker", "test@worker"];
const MAX_TILES = 9;

type Role = "router" | "worker";
type Term = {
  id: string; title: string; role: Role; engine?: string; sessionId?: string;
  argv?: string[]; cwd?: string; env?: [string, string][]; injectTask?: string; captureEngine?: string;
};
type AgentLaunch = {
  agentId: string; engine: string; argv: string[]; env: [string, string][];
  injectTask: string | null; capture: boolean; sessionId: string | null; cwd: string;
};
type Rect = { x: number; y: number; w: number; h: number };
type SysStats = { cpu: number; mem_used: number; mem_total: number };
type SavedTile = { id: string; role: Role; engine: string; sessionId: string; title: string };

// Convierte un AgentLaunch (del backend) en los campos de un tile.
function tileFromLaunch(l: AgentLaunch, role: Role, title: string): Term {
  return {
    id: l.agentId, title, role, engine: l.engine,
    sessionId: l.sessionId ?? undefined, argv: l.argv, cwd: l.cwd, env: l.env,
    injectTask: l.injectTask ?? undefined, captureEngine: l.capture ? l.engine : undefined,
  };
}
type SavedState = { id: string; name: string; routerWidth: number; tiles: SavedTile[] };
type Stage = "workspaces" | "selector" | "workspace";

function computeLayout(n: number): Rect[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0, w: 100, h: 100 }];
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

function App() {
  const [stage, setStage] = useState<Stage>("workspaces");
  const [workspace, setWorkspace] = useState<WorkspaceMeta | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [routerId, setRouterId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [maxId, setMaxId] = useState<string | null>(null);
  const [closing, setClosing] = useState<string[]>([]);
  const [routerWidth, setRouterWidth] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [stats, setStats] = useState<SysStats | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const termsRef = useRef(terms);
  termsRef.current = terms;
  const wsRef = useRef<HTMLDivElement>(null);

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

  // ---- el router pidió spawnear un worker (agente vivo, del motor elegido) ----
  useEffect(() => {
    let un: (() => void) | undefined;
    let un2: (() => void) | undefined;
    (async () => {
      un = await listen<AgentLaunch & { title: string }>("spawn-agent", (e) => {
        const t = tileFromLaunch(e.payload, "worker", e.payload.title);
        setTerms((prev) => (prev.length >= MAX_TILES ? prev : [...prev, t]));
        setActiveId(t.id);
        setMaxId(null);
      });
      // session-id capturado de codex/opencode → completar el tile (para persistir)
      un2 = await listen<{ agentId: string; sessionId: string }>("agent-session", (e) => {
        setTerms((prev) => prev.map((t) => (t.id === e.payload.agentId ? { ...t, sessionId: e.payload.sessionId } : t)));
      });
    })();
    return () => { un?.(); un2?.(); };
  }, []);

  // ---- auto-guardar el estado del workspace (debounce) ----
  useEffect(() => {
    if (stage !== "workspace" || !workspace) return;
    const t = setTimeout(() => {
      const state: SavedState = {
        id: workspace.id,
        name: workspace.name,
        routerWidth,
        tiles: termsRef.current
          .filter((x) => x.sessionId) // solo agentes (no terminales manuales)
          .map((x) => ({ id: x.id, role: x.role, engine: x.engine ?? "claude", sessionId: x.sessionId!, title: x.title })),
      };
      invoke("save_workspace", { folder: workspace.folder, state: JSON.stringify(state) }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [terms, routerWidth, stage, workspace]);

  // ---- abrir un workspace (nuevo → selector; con estado → restaurar) ----
  const openWorkspace = async (meta: WorkspaceMeta) => {
    setWorkspace(meta);
    setLaunchError(null);
    await invoke("set_active_workspace", { folder: meta.folder });
    invoke("touch_workspace", { id: meta.id }).catch(() => {});
    let saved: SavedState | null = null;
    try {
      const s = await invoke<string | null>("load_workspace", { folder: meta.folder });
      saved = s ? JSON.parse(s) : null;
    } catch { /* sin estado */ }
    if (saved && saved.tiles?.length) {
      await restoreWorkspace(meta, saved);
    } else {
      setStage("selector");
    }
  };

  // ---- restaurar tiles + revivir agentes con --resume ----
  const restoreWorkspace = async (meta: WorkspaceMeta, saved: SavedState) => {
    const next: Term[] = [];
    let rId: string | null = null;
    const routerTile = saved.tiles.find((t) => t.role === "router");
    if (routerTile) {
      try {
        const r = await invoke<AgentLaunch>("router_launch", {
          engine: routerTile.engine || "claude", cwd: meta.folder, resumeSession: routerTile.sessionId,
        });
        next.push(tileFromLaunch(r, "router", routerTile.title || `router · ${routerTile.engine}`));
        rId = r.agentId;
      } catch (e) { setLaunchError(String(e)); }
    }
    for (const t of saved.tiles.filter((x) => x.role === "worker")) {
      try {
        const w = await invoke<AgentLaunch>("worker_launch", {
          engine: t.engine || "claude", agentId: t.id, sessionId: t.sessionId, cwd: meta.folder,
        });
        next.push(tileFromLaunch(w, "worker", t.title || `worker · ${t.engine}`));
      } catch { /* worker que no resume, lo salteamos */ }
    }
    setTerms(next);
    setRouterId(rId);
    setActiveId(rId || next[0]?.id || "");
    setRouterWidth(saved.routerWidth || 50);
    setStage("workspace");
  };

  // ---- crear el router de un workspace nuevo ----
  const startRouter = async (engine: string) => {
    if (!workspace) return;
    try {
      const r = await invoke<AgentLaunch>("router_launch", { engine, cwd: workspace.folder, resumeSession: null });
      setTerms([tileFromLaunch(r, "router", `router · ${engine}`)]);
      setRouterId(r.agentId);
      setActiveId(r.agentId);
      setStage("workspace");
    } catch (e) {
      setLaunchError(String(e));
    }
  };

  const backToWorkspaces = () => {
    setTerms([]); // desmonta tiles → mata PTYs (ya persistidos)
    setRouterId(null);
    setWorkspace(null);
    setMaxId(null);
    setStage("workspaces");
  };

  // ---- terminal manual (⌘T): shell, no es agente, no se persiste ----
  const addTerminal = useCallback(() => {
    const t: Term = { id: crypto.randomUUID(), title: HOSTS[Math.floor(Math.random() * HOSTS.length)], role: "worker" };
    setTerms((prev) => (prev.length >= MAX_TILES ? prev : [...prev, t]));
    setActiveId(t.id);
    setMaxId(null);
  }, []);

  const closeTerminal = useCallback((id: string) => {
    const list = termsRef.current;
    const t = list.find((x) => x.id === id);
    if (!t || t.role === "router") return;
    setActiveId((cur) => {
      if (cur !== id) return cur;
      const idx = list.findIndex((x) => x.id === id);
      return list[idx + 1]?.id ?? list[idx - 1]?.id ?? list[0]?.id ?? "";
    });
    setClosing((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const toggleMax = useCallback((id: string) => setMaxId((cur) => (cur === id ? null : id)), []);

  useEffect(() => {
    if (closing.length === 0) return;
    const timers = closing.map((id) =>
      setTimeout(() => {
        setTerms((prev) => prev.filter((t) => t.id !== id));
        setMaxId((cur) => (cur === id ? null : cur));
        setClosing((prev) => prev.filter((x) => x !== id));
      }, 200)
    );
    return () => timers.forEach(clearTimeout);
  }, [closing]);

  useEffect(() => {
    if (stage === "workspace" && routerId && !terms.find((t) => t.id === activeId)) setActiveId(routerId);
  }, [terms, activeId, routerId, stage]);

  const focusDelta = (d: number) => {
    const list = termsRef.current;
    const idx = list.findIndex((t) => t.id === activeId);
    if (idx < 0) return;
    setActiveId(list[(idx + d + list.length) % list.length].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stage !== "workspace") return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); e.stopPropagation(); addTerminal(); }
      else if (k === "w") { e.preventDefault(); e.stopPropagation(); if (activeId) closeTerminal(activeId); }
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusDelta(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusDelta(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, addTerminal, closeTerminal, stage]);

  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const rect = wsRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setRouterWidth(Math.max(28, Math.min(78, pct)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const workers = terms.filter((t) => t.role === "worker");
  const workerRects = computeLayout(workers.length);
  const hasWorkers = workers.length > 0;

  const slotStyle = (t: Term): CSSProperties => {
    if (maxId != null) {
      return maxId === t.id
        ? { left: "0%", top: "0%", width: "100%", height: "100%", zIndex: 5 }
        : { left: "0%", top: "0%", width: "100%", height: "100%", opacity: 0, pointerEvents: "none" };
    }
    if (!hasWorkers) return { left: "0%", top: "0%", width: "100%", height: "100%" };
    if (t.role === "router") return { left: "0%", top: "0%", width: `${routerWidth}%`, height: "100%" };
    const wi = workers.findIndex((w) => w.id === t.id);
    const r = workerRects[wi] ?? { x: 0, y: 0, w: 100, h: 100 };
    const rw = 100 - routerWidth;
    return { left: `${routerWidth + (r.x * rw) / 100}%`, top: `${r.y}%`, width: `${(r.w * rw) / 100}%`, height: `${r.h}%` };
  };

  // ---- pantalla: gestor de workspaces ----
  if (stage === "workspaces") {
    return <WorkspaceManager onOpen={openWorkspace} />;
  }

  // ---- pantalla: selector de agente (workspace nuevo) ----
  if (stage === "selector") {
    return (
      <div className="shell">
        <div className="selector">
          <div className="selector__card">
            <div className="selector__brand">🧭 {workspace?.name}</div>
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
            <button className="selector__back" onClick={backToWorkspaces}>← volver a workspaces</button>
            {launchError && <div className="selector__error">{launchError}</div>}
          </div>
        </div>
      </div>
    );
  }

  // ---- pantalla: workspace ----
  return (
    <div className="shell">
      <div className="topbar">
        <div className="topbar__left">
          <button className="wsbtn" onClick={backToWorkspaces} title="Volver a workspaces">⌂</button>
          <span className="stat"><span className="stat__k">CPU</span><span className="stat__v">{stats ? `${Math.round(stats.cpu)}%` : "—"}</span></span>
          <span className="stat"><span className="stat__k">RAM</span><span className="stat__v">{stats ? `${gib(stats.mem_used)}/${gib(stats.mem_total)}G` : "—"}</span></span>
        </div>
        <div className="topbar__center">HyprDesk · {workspace?.name}</div>
        <div className="topbar__right">
          <span className="stat stat--live"><span className="dot" /> {terms.length} sesión{terms.length > 1 ? "es" : ""}</span>
        </div>
      </div>

      <div className={`workspace ${dragging ? "workspace--dragging" : ""}`} ref={wsRef}>
        {terms.map((t) => (
          <div className={`slot ${closing.includes(t.id) ? "slot--closing" : ""}`} key={t.id} style={slotStyle(t)}>
            <TerminalTile
              id={t.id}
              title={t.title}
              active={activeId === t.id}
              isRouter={t.role === "router"}
              canClose={t.role === "worker"}
              maximized={maxId === t.id}
              argv={t.argv}
              cwd={t.cwd}
              env={t.env}
              injectTask={t.injectTask}
              captureEngine={t.captureEngine}
              onFocus={setActiveId}
              onClose={closeTerminal}
              onToggleMax={toggleMax}
            />
          </div>
        ))}

        {hasWorkers && maxId == null && (
          <div className="divider" style={{ left: `${routerWidth}%` }} onMouseDown={startDrag} title="Arrastrá para ajustar el router" />
        )}

        <button className="fab" title="Terminal manual (⌘T)" onClick={addTerminal}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="statusbar">
        <span className="statusbar__role"><span className="dot dot--router" /> router · {workers.length} worker{workers.length !== 1 ? "s" : ""}</span>
        <span className="statusbar__keys"><kbd>⌘T</kbd> terminal · <kbd>⌘W</kbd> cerrar · <kbd>⌘←→</kbd> foco · doble-click maximiza</span>
        <span className="statusbar__hint">Pedile al router (izquierda) que haga algo — él delega workers</span>
      </div>
    </div>
  );
}

export default App;
