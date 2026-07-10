// Barra de actividad (rail izquierdo): switch de paneles + comandos + configuración.
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function ActivityBar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const panel = useUiStore((s) => s.panel);
  const openPanel = useUiStore((s) => s.openPanel);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const rightOpen = useUiStore((s) => s.rightOpen);
  const setRightOpen = useUiStore((s) => s.setRightOpen);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const changeCount = useSessionStore((s) => {
    const cur = s.sessions.find((x) => x.meta.id === s.currentId);
    const c = cur ? s.changesByWs[cur.meta.folder] : undefined;
    return c ? (c.git.length || c.watched.length) : 0;
  });
  const on = (p: string) => (sidebarOpen && panel === p ? "act--on" : "");
  // clic en el ícono del panel YA activo → colapsa/expande el sidebar (comportamiento VS Code).
  const clickPanel = (p: Parameters<typeof openPanel>[0]) => {
    if (sidebarOpen && panel === p) setSidebarOpen(false);
    else openPanel(p);
  };

  return (
    <div className="activitybar">
      <button className={`act ${on("workspaces")}`} title="Workspaces" onClick={() => clickPanel("workspaces")}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 6.5A1.5 1.5 0 014.5 5H8l1.8 1.8H15.5A1.5 1.5 0 0117 8.3v6.2A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5v-8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
      </button>
      <button className={`act ${on("agents")}`} title="Agentes (⌘B)" onClick={() => clickPanel("agents")}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      <button className={`act ${on("files")}`} title="Archivos" onClick={() => clickPanel("files")}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M11 3H5.5A1.5 1.5 0 004 4.5v11A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V8l-5-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M11 3v4.5H16" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
      </button>
      <button className={`act ${rightOpen ? "act--on" : ""}`} title="Source Control" onClick={() => setRightOpen((o) => !o)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" /><circle cx="6" cy="15" r="2.2" stroke="currentColor" strokeWidth="1.4" /><circle cx="14" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" /><path d="M6 8.2v4.6M14 8.2c0 3-2.5 4-4.5 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        {changeCount > 0 && <span className="act__badge">{changeCount > 99 ? "99+" : changeCount}</span>}
      </button>
      <button className="act" title="Comandos (⌘K)" onClick={togglePalette}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      <button className="act act--bottom" title="Configuración (⌘,)" onClick={() => setSettingsOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
