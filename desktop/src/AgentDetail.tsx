import type { AgentIdentity } from "./types";
import { EngineIcon } from "./EngineIcon";

// QUIÉN es un agente. Antes esto no se podía ver: la persona y las skills se quemaban en el system
// prompt y se descartaban, así que un agente diseñado por el ROUTER era una caja negra — sabías que
// existía, no qué era. Ahora la identidad es un dato, y esto la muestra: la del que creaste vos y la
// del que creó el router, con la misma riqueza.
export function AgentDetail({
  title, engine, color, branch, identity, dead, onSaveAsProfile, onClose,
}: {
  title: string;
  engine?: string;
  color?: string;
  branch?: string;
  identity: AgentIdentity;
  dead?: boolean;
  onSaveAsProfile?: () => void; // solo para agentes vivos (un perfil ya ES un perfil)
  onClose: () => void;
}) {
  const { model, effort, persona, task, skills } = identity;
  const meta = [engine, model, effort].filter(Boolean).join(" · ");

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal--wide agdet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="agdet__dot" style={{ background: color || "var(--router)" }} />
          {engine && <EngineIcon engine={engine} size={18} />}
          <span className="modal__title">{title}</span>
          <button className="modal__close" onClick={onClose} title="Cerrar">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="modal__section agdet__body">
          <div className="agdet__meta">
            {meta && <span className="agdet__chip">{meta}</span>}
            {branch && <span className="agdet__chip" title="rama del worktree">⑂ {branch}</span>}
            {dead && <span className="agdet__chip agdet__chip--dead">terminado</span>}
          </div>

          <div className="agdet__field">
            <span className="agdet__label">Skills</span>
            {skills && skills.length > 0 ? (
              <div className="agdet__skills">
                {skills.map((s) => <span key={s} className="agdet__skill">{s}</span>)}
              </div>
            ) : (
              <p className="agdet__empty">Ninguna. Solo lleva Ponytail, que va en todos los agentes.</p>
            )}
          </div>

          <div className="agdet__field">
            <span className="agdet__label">Personalidad</span>
            {persona?.trim() ? (
              <pre className="agdet__text">{persona}</pre>
            ) : (
              <p className="agdet__empty">Sin personalidad propia: corre con el rol de worker por defecto.</p>
            )}
          </div>

          {task?.trim() && (
            <div className="agdet__field">
              <span className="agdet__label">Tarea con la que se lanzó</span>
              <pre className="agdet__text">{task}</pre>
            </div>
          )}
        </div>

        {onSaveAsProfile && (
          <div className="modal__foot agdet__foot">
            <span className="agdet__hint">Guardalo como perfil y lo relanzás cuando quieras.</span>
            <button className="modal__save" onClick={onSaveAsProfile}>Guardar como perfil</button>
          </div>
        )}
      </div>
    </div>
  );
}
