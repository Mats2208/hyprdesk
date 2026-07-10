import { useState } from "react";
import type { Profile } from "./types";

const CloseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// Lanza un EQUIPO: elegís qué perfiles pre-spawnear como workers (idle o con un objetivo compartido).
// Quedan vivos y reportando al router, que después les delega con send_to_worker.
export function TeamModal({
  profiles, canLaunch, onClose, onLaunch,
}: {
  profiles: Profile[];
  canLaunch: boolean;
  onClose: () => void;
  onLaunch: (selected: Profile[], goal: string) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(profiles.map((p) => p.id)));
  const [goal, setGoal] = useState("");

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const chosen = profiles.filter((p) => sel.has(p.id));

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="modal__title">Lanzar equipo</span>
          <button className="modal__close" onClick={onClose} title="Cerrar"><CloseIcon /></button>
        </div>

        <div className="modal__section">
          <div className="modal__hint">Elegí qué perfiles pre-spawnear como workers. Quedan vivos y listos; el router les delega después. Podés darles un objetivo compartido (opcional).</div>

          {profiles.length === 0 ? (
            <div className="team__empty">No hay perfiles en este workspace. Creá uno con “＋ Crear agente”.</div>
          ) : (
            <div className="team__list">
              {profiles.map((p) => (
                <div key={p.id} className={`team__row ${sel.has(p.id) ? "team__row--on" : ""}`} onClick={() => toggle(p.id)}>
                  <span className="team__check"><CheckIcon /></span>
                  <span className="team__dot" style={{ background: p.color }} />
                  <span className="team__name">{p.name}</span>
                  <span className="team__meta">{p.engine}{p.model ? ` · ${p.model}` : ""}</span>
                </div>
              ))}
            </div>
          )}

          {profiles.length > 0 && (
            <label className="modal__field" style={{ marginTop: 4 }}>
              <span>Objetivo del equipo (opcional)</span>
              <textarea value={goal} rows={2} onChange={(e) => setGoal(e.target.value)}
                placeholder="Ej: vamos a construir el módulo de auth — esperá instrucciones del router." />
            </label>
          )}
        </div>

        <div className="modal__foot">
          <button
            className="modal__save"
            disabled={!canLaunch || chosen.length === 0}
            title={canLaunch ? "" : "Necesitás un router en el workspace"}
            onClick={() => { onLaunch(chosen, goal.trim()); onClose(); }}
          >
            Lanzar {chosen.length || ""} agente{chosen.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
