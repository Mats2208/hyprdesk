// Barra de título: stats (CPU/RAM/GLM), nombre del workspace + rama, contador de tiles y botón de comandos.
import type { GlmUsage, SysStats } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";
import { THEME_LABEL, useThemeStore } from "../theme/theme";

const gib = (b: number) => (b / 1024 ** 3).toFixed(1);

// Íconos por tema (luna / sol / contraste).
const THEME_ICON = {
  dark: <path d="M13.5 10.2A5 5 0 016.8 3.5a5.5 5.5 0 106.7 6.7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />,
  light: <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" /></g>,
  hc: <g><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" /><path d="M8 2a6 6 0 010 12z" fill="currentColor" /></g>,
};

export function TitleBar({ stats, glm, branch }: { stats: SysStats | null; glm: GlmUsage | null; branch: string | null }) {
  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const theme = useThemeStore((s) => s.theme);
  const cycle = useThemeStore((s) => s.cycleTheme);

  return (
    <div className="titlebar">
      <div className="titlebar__side">
        <span className="stat"><span className="stat__k">CPU</span><span className="stat__v">{stats ? `${Math.round(stats.cpu)}%` : "—"}</span></span>
        <span className="stat"><span className="stat__k">RAM</span><span className="stat__v">{stats ? `${gib(stats.mem_used)}/${gib(stats.mem_total)}G` : "—"}</span></span>
        {glm && (glm.session != null || glm.weekly != null) && (
          <span className="stat stat--usage" title="Cuota de GLM (z.ai) — 5 horas / semanal">
            <span className="stat__k">GLM</span>
            <span className="stat__v">{glm.session != null ? `5h ${Math.round(glm.session)}%` : ""}{glm.session != null && glm.weekly != null ? " · " : ""}{glm.weekly != null ? `sem ${Math.round(glm.weekly)}%` : ""}</span>
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
        <button className="titlebar__icon" onClick={cycle} title={`Tema: ${THEME_LABEL[theme]} (clic para cambiar)`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">{THEME_ICON[theme]}</svg>
        </button>
        <button className="titlebar__cmd" onClick={togglePalette}>Comandos <kbd>⌘K</kbd></button>
      </div>
    </div>
  );
}
