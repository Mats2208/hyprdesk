// Barra de tabs del centro (estilo editor groups de VS Code): cada tile/agente = una tab.
// Click → enfoca; doble-click o botón → maximiza (foco simple) / restaura (grid).
import { ENGINE_COLOR } from "../Sidebar";
import { useSessionStore } from "../store/sessionStore";

export function CenterTabs() {
  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const { setActive, closeTerminal, toggleMax } = useSessionStore.getState();

  if (!current || current.needsRouter || current.terms.length === 0) return null;
  const maxed = current.maxId != null;

  return (
    <div className="ctabs">
      <div className="ctabs__list">
        {current.terms.map((t) => (
          <button
            key={t.id}
            className={`ctab ${current.activeId === t.id ? "ctab--active" : ""}`}
            onClick={() => setActive(t.id)}
            onDoubleClick={() => toggleMax(t.id)}
            title={t.title}
          >
            <span className="ctab__dot" style={{ background: t.role === "router" ? "var(--accent)" : (t.color || ENGINE_COLOR[t.engine || "claude"] || "var(--faint)") }} />
            <span className="ctab__name">{t.title}</span>
            {t.role === "worker" && (
              <span
                className="ctab__close"
                title="Cerrar"
                onClick={(e) => { e.stopPropagation(); closeTerminal(t.id); }}
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        className={`ctabs__view ${maxed ? "ctabs__view--on" : ""}`}
        title={maxed ? "Ver todos (grid)" : "Enfocar el activo"}
        onClick={() => toggleMax(current.activeId)}
      >
        {maxed ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" /></svg>
        )}
      </button>
    </div>
  );
}
