// Panel "Web": abrir cualquier URL como tile de navegador y listar las pestañas abiertas de la
// sesión actual. Reusa openBrowser (dedupe + autodetección de localhost ya viven en el store) y las
// clases del sidebar para no inventar estilos nuevos.
import { useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { normalize } from "../BrowserTile";

function Globe() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 8h12M8 2c1.8 1.7 2.7 3.8 2.7 6S9.8 12.3 8 14C6.2 12.3 5.3 10.2 5.3 8S6.2 3.7 8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function WebPanel() {
  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const { openBrowser, setActive, closeTerminal } = useSessionStore.getState();
  const [addr, setAddr] = useState("");

  const tabs = current?.terms.filter((t) => t.kind === "browser") ?? [];
  const activeId = current?.activeId ?? "";

  const open = () => {
    const u = normalize(addr);
    if (!u) return;
    openBrowser(u);
    setAddr("");
  };

  return (
    <div className="sidebar">
      <div className="sidebar__head"><span>Web</span></div>

      <div className="sidebar__newws" style={{ borderTop: "none", borderBottom: "1px solid var(--hairline)" }}>
        <input
          value={addr}
          placeholder="localhost:3000 · https://…"
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") open(); }}
        />
        <button title="Abrir" disabled={!addr.trim()} onClick={open}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h9M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="sidebar__list">
        {tabs.length === 0 ? (
          <div className="fslist__empty">Sin pestañas. Abrí una URL arriba, o tocá un preview de <code>localhost</code>.</div>
        ) : (
          tabs.map((t) => (
            <div key={t.id} className={`wsrow ${activeId === t.id ? "wsrow--active" : ""}`}>
              <button className="wsrow__open" onClick={() => setActive(t.id)} title={t.url || t.title}>
                <Globe />
                <span className="wsrow__name">{t.title}</span>
              </button>
              <div className="wsrow__actions wsrow__actions--show">
                <button className="tctl tctl--close" title="Cerrar" onClick={() => closeTerminal(t.id)}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
