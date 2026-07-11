// Barra de título: stats (CPU/RAM + cuota GLM/Codex/Claude), nombre del workspace + rama, contador
// de tiles y botón de comandos.
import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AgentUsage, SysStats } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";
import { THEME_LABEL, useThemeStore } from "../theme/theme";
import { BrandMark } from "../BrandMark";
import { hk, isMac } from "../platform";

const gib = (b: number) => (b / 1024 ** 3).toFixed(1);

// Chip de cuota "5h X% · sem Y%" (% USADO). Se oculta si no hay dato (no logueado / API caído).
function UsageChip({ label, title, u }: { label: string; title: string; u: AgentUsage | null }) {
  if (!u || (u.session == null && u.weekly == null)) return null;
  return (
    <span className="stat stat--usage" title={title}>
      <span className="stat__k">{label}</span>
      <span className="stat__v">
        {u.session != null ? `5h ${Math.round(u.session)}%` : ""}
        {u.session != null && u.weekly != null ? " · " : ""}
        {u.weekly != null ? `sem ${Math.round(u.weekly)}%` : ""}
      </span>
    </span>
  );
}

// Íconos por tema (luna / sol / contraste).
const THEME_ICON = {
  dark: <path d="M13.5 10.2A5 5 0 016.8 3.5a5.5 5.5 0 106.7 6.7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />,
  light: <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" /></g>,
  hc: <g><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" /><path d="M8 2a6 6 0 010 12z" fill="currentColor" /></g>,
};

export function TitleBar({ stats, glm, codex, claude }: {
  stats: SysStats | null; glm: AgentUsage | null; codex: AgentUsage | null; claude: AgentUsage | null;
}) {
  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const theme = useThemeStore((s) => s.theme);
  const cycle = useThemeStore((s) => s.cycleTheme);

  return (
    <div className={`titlebar ${isMac ? "" : "titlebar--custom"}`}>
      <div className="titlebar__side">
        <span className="stat"><span className="stat__k">CPU</span><span className="stat__v">{stats ? `${Math.round(stats.cpu)}%` : "—"}</span></span>
        <span className="stat"><span className="stat__k">RAM</span><span className="stat__v">{stats ? `${gib(stats.mem_used)}/${gib(stats.mem_total)}G` : "—"}</span></span>
        <UsageChip label="Claude" title="Consumo de Claude — ciclo de 5 horas / semanal" u={claude} />
        <UsageChip label="Codex" title="Consumo de Codex (ChatGPT) — ciclo de 5 horas / semanal" u={codex} />
        <UsageChip label="GLM" title="Cuota de GLM (z.ai) — 5 horas / semanal" u={glm} />
      </div>
      <div className="titlebar__title">
        <BrandMark size={15} className="titlebar__mark" />
        <span className="titlebar__app">HyprDesk</span>
        <span className="titlebar__sep">·</span>
        <span className="titlebar__ws">{current?.meta.name ?? ""}</span>
      </div>
      <div className="titlebar__side titlebar__side--right">
        <span className="stat stat--live" title="agentes / tiles"><span className="dot" /> {current?.terms.length ?? 0}</span>
        <button className="titlebar__icon" onClick={cycle} title={`Tema: ${THEME_LABEL[theme]} (clic para cambiar)`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">{THEME_ICON[theme]}</svg>
        </button>
        <button className="titlebar__cmd" onClick={togglePalette}>Comandos <kbd>{hk("K")}</kbd></button>
      </div>
      {!isMac && <WindowControls />}
    </div>
  );
}

// Controles de ventana (min/max/cerrar) para Windows/Linux frameless. En macOS los pone el SO.
function WindowControls() {
  const win = useMemo(() => getCurrentWindow(), []);
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    let un: (() => void) | undefined;
    win.isMaximized().then(setMaxed).catch(() => {});
    win.onResized(() => { win.isMaximized().then(setMaxed).catch(() => {}); }).then((f) => { un = f; });
    return () => un?.();
  }, [win]);
  return (
    <div className="wctl">
      <button className="wctl__btn" title="Minimizar" onClick={() => void win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5h6" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button className="wctl__btn" title={maxed ? "Restaurar" : "Maximizar"} onClick={() => void win.toggleMaximize()}>
        {maxed ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="3" width="5" height="5" stroke="currentColor" strokeWidth="1" /><path d="M4 3V1.5h4.5V6H7" stroke="currentColor" strokeWidth="1" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1" /></svg>
        )}
      </button>
      <button className="wctl__btn wctl__btn--close" title="Cerrar" onClick={() => void win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}
