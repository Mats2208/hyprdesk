// Barra de actividad (rail izquierdo): switch de paneles + comandos + configuración.
import { useUiStore } from "../store/uiStore";
import { hk } from "../platform";

export function ActivityBar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const panel = useUiStore((s) => s.panel);
  const openPanel = useUiStore((s) => s.openPanel);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
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
      <button className={`act ${on("agents")}`} title={`Agentes (${hk("B")})`} onClick={() => clickPanel("agents")}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      <button className={`act ${on("files")}`} title="Archivos" onClick={() => clickPanel("files")}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5.5 3h5l4 4v10a0 0 0 01 0 0H5.5A1.5 1.5 0 014 15.5v-11A1.5 1.5 0 015.5 3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M10.5 3v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
      </button>
      <button className={`act ${on("web")}`} title="Web" onClick={() => clickPanel("web")}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" /><path d="M3 10h14M10 3c2.2 2 3.3 4.5 3.3 7S12.2 15 10 17c-2.2-2-3.3-4.5-3.3-7S7.8 5 10 3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
      </button>
      <button className="act" title={`Comandos (${hk("K")})`} onClick={togglePalette}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" /><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      <button className="act act--bottom" title={`Configuración (${hk(",")})`} onClick={() => setSettingsOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
