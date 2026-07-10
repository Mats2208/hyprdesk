// Grilla de tiles de UNA sesión (montada siempre; visible solo la actual). Router a la izquierda,
// workers en cuadrícula a la derecha; divisor arrastrable; FAB de terminal manual.
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { TerminalTile } from "../TerminalTile";
import { BrowserTile } from "../BrowserTile";
import type { Term, WsSession } from "../types";
import { computeLayout } from "../store/sessionModel";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function TileGrid({ session: s }: { session: WsSession }) {
  const currentId = useSessionStore((st) => st.currentId);
  const closing = useSessionStore((st) => st.closing);
  const { setActive, closeTerminal, toggleMax, mergeWorker, addPreview, addTerminal, updateSession } = useSessionStore.getState();
  const dragging = useUiStore((st) => st.dragging);
  const setDragging = useUiStore((st) => st.setDragging);
  const setStatus = useUiStore((st) => st.setStatus);
  const activity = useUiStore((st) => st.activity);
  const paletteOpen = useUiStore((st) => st.paletteOpen);
  const settingsOpen = useUiStore((st) => st.settingsOpen);
  const createAgentOpen = useUiStore((st) => st.createAgentOpen);

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

  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    const ws = (e.currentTarget as HTMLElement).closest(".workspace") as HTMLElement | null;
    if (!ws) return;
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const rect = ws.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      updateSession(s.meta.id, (x) => ({ ...x, routerWidth: Math.max(28, Math.min(78, pct)) }));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className={`workspace ${dragging && isCurrent ? "workspace--dragging" : ""}`}>
      {s.terms.map((t) => (
        <div className={`slot ${closing.includes(t.id) ? "slot--closing" : ""}`} key={t.id} style={slotStyle(t)}>
          {t.kind === "file" || t.kind === "diff" ? null : t.kind === "browser" ? (
            <BrowserTile
              id={t.id} title={t.title} active={s.activeId === t.id} canClose={t.role === "worker"}
              maximized={s.maxId === t.id} url={t.url}
              hidden={paletteOpen || settingsOpen || createAgentOpen || s.meta.id !== currentId || (s.maxId != null && s.maxId !== t.id)}
              onFocus={setActive} onClose={closeTerminal} onToggleMax={toggleMax}
            />
          ) : (
            <TerminalTile
              id={t.id} title={t.title} active={s.activeId === t.id} isRouter={t.role === "router"}
              canClose={t.role === "worker"} maximized={s.maxId === t.id}
              argv={t.argv} cwd={t.cwd} env={t.env} injectTask={t.injectTask} captureEngine={t.captureEngine}
              hasActivity={activity.includes(t.id)} color={t.color} branch={t.branch}
              onFocus={setActive} onClose={closeTerminal} onToggleMax={toggleMax} onMerge={mergeWorker}
              onDetectUrl={(url) => addPreview(s.meta.folder, url)}
              onStatus={(tid, st) => setStatus(tid, st)}
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
}
