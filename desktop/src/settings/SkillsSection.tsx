// Hub de skills (gestión local): togglea qué skills de DOMINIO se inyectan por default en cada worker.
// Ponytail va SIEMPRE y no se puede desactivar (se muestra fija). Las default-on se guardan en
// settings.json (defaultSkills); el valor y el guardado los maneja SettingsView (para no pisar el
// resto de la config). Las skills fijas por-perfil se eligen en el modal de crear agente, no acá.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SkillInfo } from "../types";

export function SkillsSection({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<SkillInfo[]>("list_skills").then(setSkills).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const toggle = (name: string, on: boolean) => {
    onChange(on ? [...value, name] : value.filter((s) => s !== name));
  };

  return (
    <div className="skills">
      <div className="settings__field">
        <div className="settings__flabel">Skills por default</div>
        <div className="settings__fdesc">
          Las skills marcadas se inyectan automáticamente en TODOS los workers que lances. Ponytail va
          siempre. Las skills de un perfil se eligen al crear el agente.
        </div>
      </div>

      <div className="skills__row skills__row--fixed" title="Siempre activa en todos los agentes">
        <span className="skills__check skills__check--on">✓</span>
        <span className="skills__meta">
          <span className="skills__name">ponytail <em className="skills__tag">siempre</em></span>
          <span className="skills__summary">Modo senior perezoso — eficiencia de tokens.</span>
        </span>
      </div>

      {skills.map((s) => {
        const on = value.includes(s.name);
        return (
          <button
            key={s.name} type="button" className="skills__row"
            aria-pressed={on} onClick={() => toggle(s.name, !on)}
          >
            <span className={`skills__check ${on ? "skills__check--on" : ""}`}>{on ? "✓" : ""}</span>
            <span className="skills__meta">
              <span className="skills__name">{s.name}</span>
              {s.summary && <span className="skills__summary">{s.summary}</span>}
            </span>
          </button>
        );
      })}

      {loaded && skills.length === 0 && (
        <div className="settings__fdesc">No hay skills de dominio instaladas (solo Ponytail, que ya va siempre).</div>
      )}
    </div>
  );
}
