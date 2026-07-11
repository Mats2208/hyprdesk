// Selector de agente router para una sesión nueva (sin router aún).
import type { WsSession } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { EngineIcon } from "../EngineIcon";

const ROUTERS = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "opencode", name: "OpenCode" },
];

export function RouterSelector({ session: s }: { session: WsSession }) {
  const { startRouter, closeWorkspace } = useSessionStore.getState();
  return (
    <div className="selector selector--inline">
      <div className="selector__card">
        <div className="selector__brand">{s.meta.name}</div>
        <div className="selector__title">Elegí tu agente router</div>
        <div className="selector__sub">Vas a hablar con él; delega workers reales por vos.</div>
        <div className="selector__agents">
          {ROUTERS.map((r) => (
            <button key={r.id} className="agent-btn" onClick={() => startRouter(r.id)}>
              <EngineIcon engine={r.id} size={22} />
              <span className="agent-btn__name">{r.name}</span>
              <span className="agent-btn__go">Iniciar →</span>
            </button>
          ))}
        </div>
        <button className="selector__back" onClick={() => closeWorkspace(s.meta.id)}>← cerrar este workspace</button>
        {s.launchError && <div className="selector__error">{s.launchError}</div>}
      </div>
    </div>
  );
}
