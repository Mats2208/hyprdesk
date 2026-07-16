// Grilla de tiles de UNA sesión (montada siempre; visible solo la actual). Router a la izquierda,
// workers en cuadrícula a la derecha; divisor arrastrable; FAB de terminal manual.
// Los workers se reordenan arrastrando su header y soltando sobre otro worker: como la posición
// es función del orden en s.terms (ver computeLayout), intercambiar dos índices basta y los tiles
// se deslizan solos con la transición del .slot.
import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { TerminalTile } from "../TerminalTile";
import { BrowserTile } from "../BrowserTile";
import { FileTile } from "../FileTile";
import type { Term, WsSession } from "../types";
import { computeLayout } from "../store/sessionModel";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";
import { hk } from "../platform";

export function TileGrid({ session: s }: { session: WsSession }) {
  const currentId = useSessionStore((st) => st.currentId);
  const closing = useSessionStore((st) => st.closing);
  const { setActive, closeTerminal, toggleMax, mergeWorker, addPreview, addTerminal, updateSession, openBrowser, restartTile } = useSessionStore.getState();
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

  // --- reordenar workers por arrastre (swap) ---
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const isWorkerId = (id: string | null | undefined) =>
    !!id && s.terms.some((t) => t.id === id && t.role === "worker");

  const swapWorkers = (a: string, b: string) => {
    updateSession(s.meta.id, (x) => {
      const terms = [...x.terms];
      const ia = terms.findIndex((t) => t.id === a);
      const ib = terms.findIndex((t) => t.id === b);
      if (ia < 0 || ib < 0) return x;
      if (terms[ia].role !== "worker" || terms[ib].role !== "worker") return x;
      [terms[ia], terms[ib]] = [terms[ib], terms[ia]];
      return { ...x, terms };
    });
  };

  const slotUnder = (x: number, y: number): string | null => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(".slot") as HTMLElement | null;
    return el?.dataset.tileId ?? null;
  };

  // Arranca solo si el pointerdown nació en el header (no en los controles) y es un worker.
  // Umbral de 5px para no pisar el click ni el doble-click (maximizar).
  const onSlotPointerDown = (e: ReactPointerEvent, t: Term) => {
    if (e.button !== 0 || t.role !== "worker" || s.maxId != null) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".tile__header") || target.closest(".tile__controls, button")) return;
    const startX = e.clientX, startY = e.clientY;
    let armed = false;
    // worker distinto bajo el puntero = destino válido del swap (misma regla para resaltar y soltar).
    const dropTarget = (ev: PointerEvent): string | null => {
      const over = slotUnder(ev.clientX, ev.clientY);
      return over && over !== t.id && isWorkerId(over) ? over : null;
    };
    const onMove = (ev: PointerEvent) => {
      if (!armed) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        armed = true;
        setDragId(t.id);
      }
      setOverId(dropTarget(ev));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const over = armed ? dropTarget(ev) : null;
      if (over) swapWorkers(t.id, over);
      setDragId(null);
      setOverId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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
    <div className={`workspace ${dragging && isCurrent ? "workspace--dragging" : ""} ${dragId ? "workspace--reordering" : ""}`}>
      {s.terms.map((t) => (
        // la key lleva `gen`: al revivir un agente cambia → React remonta el tile → PTY nuevo.
        <div
          className={`slot ${closing.includes(t.id) ? "slot--closing" : ""} ${dragId === t.id ? "slot--dragging" : ""} ${overId === t.id ? "slot--drop" : ""}`}
          key={`${t.id}:${t.gen ?? 0}`}
          data-tile-id={t.id}
          style={slotStyle(t)}
          onPointerDown={(e) => onSlotPointerDown(e, t)}
        >
          {t.kind === "file" ? (
            <FileTile
              id={t.id} title={t.title} filePath={t.filePath ?? ""} active={s.activeId === t.id} canClose={t.role === "worker"}
              maximized={s.maxId === t.id}
              hidden={paletteOpen || settingsOpen || createAgentOpen || s.meta.id !== currentId || (s.maxId != null && s.maxId !== t.id)}
              onFocus={setActive} onClose={closeTerminal} onToggleMax={toggleMax}
            />
          ) : t.kind === "browser" ? (
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
              onRestart={restartTile}
              onDetectUrl={(url) => addPreview(s.meta.folder, url)}
              onOpenLink={(url) => openBrowser(url)}
              onStatus={(tid, st) => setStatus(tid, st)}
            />
          )}
        </div>
      ))}

      {hasWorkers && s.maxId == null && (
        <div className="divider" style={{ left: `${s.routerWidth}%` }} onMouseDown={startDrag} title="Arrastrá para ajustar el router" />
      )}

      <button className="fab" title={`Terminal manual (${hk("T")})`} onClick={addTerminal}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
