import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalTile } from "./TerminalTile";

const HOSTS = ["dev@worker", "codex@worker", "build@worker", "review@worker"];
const MAX_TILES = 9;

type Role = "router" | "worker";
type Term = { id: string; title: string; role: Role; argv?: string[]; cwd?: string };
type Rect = { x: number; y: number; w: number; h: number };
type SysStats = { cpu: number; mem_used: number; mem_total: number };

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

function gib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function App() {
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

  const selecting = routerId === null;

  // ---- lanzar el agente-router elegido (claude interactivo + MCP hyprdesk) ----
  const startRouter = async (engine: string) => {
    try {
      const { agentId, argv, cwd } = await invoke<{ agentId: string; argv: string[]; cwd: string }>("router_launch", { engine });
      setTerms([{ id: agentId, title: `router · ${engine}`, role: "router", argv, cwd }]);
      setRouterId(agentId);
      setActiveId(agentId);
    } catch (e) {
      setLaunchError(String(e));
    }
  };

  // ---- stats reales del sistema ----
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const s = await invoke<SysStats>("system_stats"); if (alive) setStats(s); } catch { /**/ }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // ---- el router pidió spawnear un worker: abrir un tile con un agente VIVO e interactivo ----
  useEffect(() => {
    let un: (() => void) | undefined;
    (async () => {
      un = await listen<{ agentId: string; title: string; argv: string[]; cwd: string }>("spawn-agent", (e) => {
        const { agentId, title, argv, cwd } = e.payload;
        setTerms((prev) => (prev.length >= MAX_TILES ? prev : [...prev, { id: agentId, title, role: "worker", argv, cwd }]));
        setActiveId(agentId);
        setMaxId(null);
      });
    })();
    return () => { un?.(); };
  }, []);

  const addTerminal = useCallback(() => {
    const t: Term = { id: crypto.randomUUID(), title: HOSTS[Math.floor(Math.random() * HOSTS.length)], role: "worker" };
    setTerms((prev) => (prev.length >= MAX_TILES ? prev : [...prev, t]));
    setActiveId(t.id);
    setMaxId(null);
  }, []);

  const closeTerminal = useCallback((id: string) => {
    const list = termsRef.current;
    const t = list.find((x) => x.id === id);
    if (!t || t.role === "router") return; // el router no se cierra
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
    if (routerId && !terms.find((t) => t.id === activeId)) setActiveId(routerId);
  }, [terms, activeId, routerId]);

  const focusDelta = (d: number) => {
    const list = termsRef.current;
    const idx = list.findIndex((t) => t.id === activeId);
    if (idx < 0) return;
    setActiveId(list[(idx + d + list.length) % list.length].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [activeId, addTerminal, closeTerminal]);

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
    return {
      left: `${routerWidth + (r.x * rw) / 100}%`,
      top: `${r.y}%`,
      width: `${(r.w * rw) / 100}%`,
      height: `${r.h}%`,
    };
  };

  // ---- pantalla de selección de agente ----
  if (selecting) {
    return (
      <div className="shell">
        <div className="selector">
          <div className="selector__card">
            <div className="selector__brand">HyprDesk</div>
            <div className="selector__title">Elegí tu agente router</div>
            <div className="selector__sub">Vas a hablar con él; delega workers reales por vos.</div>
            <div className="selector__agents">
              <button className="agent-btn" onClick={() => startRouter("claude")}>
                <span className="agent-btn__name">Claude Code</span>
                <span className="agent-btn__go">Iniciar →</span>
              </button>
              <button className="agent-btn agent-btn--soon" disabled>
                <span className="agent-btn__name">Codex</span>
                <span className="agent-btn__soon">próximamente</span>
              </button>
              <button className="agent-btn agent-btn--soon" disabled>
                <span className="agent-btn__name">OpenCode</span>
                <span className="agent-btn__soon">próximamente</span>
              </button>
            </div>
            {launchError && <div className="selector__error">{launchError}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="topbar__left">
          <span className="stat"><span className="stat__k">CPU</span><span className="stat__v">{stats ? `${Math.round(stats.cpu)}%` : "—"}</span></span>
          <span className="stat"><span className="stat__k">RAM</span><span className="stat__v">{stats ? `${gib(stats.mem_used)}/${gib(stats.mem_total)}G` : "—"}</span></span>
        </div>
        <div className="topbar__center">HyprDesk</div>
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
