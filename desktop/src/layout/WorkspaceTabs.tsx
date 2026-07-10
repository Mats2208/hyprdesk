// Tabs de los workspaces abiertos (keep-alive): switch instantáneo + cerrar.
import { useSessionStore } from "../store/sessionStore";

export function WorkspaceTabs() {
  const sessions = useSessionStore((s) => s.sessions);
  const currentId = useSessionStore((s) => s.currentId);
  const setCurrentId = useSessionStore((s) => s.setCurrentId);
  const closeWorkspace = useSessionStore((s) => s.closeWorkspace);

  return (
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
  );
}
