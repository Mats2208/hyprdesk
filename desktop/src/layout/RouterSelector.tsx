// Selector de agente router para una sesión nueva (sin router aún).
import type { WsSession } from "../types";
import { useSessionStore } from "../store/sessionStore";

export function RouterSelector({ session: s }: { session: WsSession }) {
  const { startRouter, closeWorkspace } = useSessionStore.getState();
  return (
    <div className="selector selector--inline">
      <div className="selector__card">
        <div className="selector__brand">🧭 {s.meta.name}</div>
        <div className="selector__title">Elegí tu agente router</div>
        <div className="selector__sub">Vas a hablar con él; delega workers reales por vos.</div>
        <div className="selector__agents">
          <button className="agent-btn" onClick={() => startRouter("claude")}>
            <span className="agent-btn__name">Claude Code</span>
            <span className="agent-btn__go">Iniciar →</span>
          </button>
          <button className="agent-btn" onClick={() => startRouter("codex")}>
            <span className="agent-btn__name">Codex</span>
            <span className="agent-btn__go">Iniciar →</span>
          </button>
          <button className="agent-btn" onClick={() => startRouter("opencode")}>
            <span className="agent-btn__name">OpenCode</span>
            <span className="agent-btn__go">Iniciar →</span>
          </button>
        </div>
        <button className="selector__back" onClick={() => closeWorkspace(s.meta.id)}>← cerrar este workspace</button>
        {s.launchError && <div className="selector__error">{s.launchError}</div>}
      </div>
    </div>
  );
}
