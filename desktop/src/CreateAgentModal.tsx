import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Profile, SkillInfo } from "./types";

const COLORS = ["#34d399", "#60a5fa", "#c084fc", "#fbbf24", "#f87171", "#22d3ee", "#f472b6", "#a3e635"];

type Catalog = { claude: string[]; codex: string[]; opencode: string[] };

function catalogText(c: Catalog | null): string {
  const oc = c?.opencode?.length ? c.opencode.join(", ") : "(no disponible — no elijas opencode)";
  const cx = c?.codex?.length ? c.codex.join(", ") : "gpt-5.6-terra, gpt-5.6-sol";
  const cl = c?.claude?.length ? c.claude.join(", ") : "opus, sonnet, haiku";
  return `Motores y modelos VÁLIDOS (usá EXACTAMENTE uno de estos strings como "model", no inventes):
- claude (Claude Code): ${cl}. Sin "effort" (null). Fuerte en razonamiento/arquitectura.
- codex (OpenAI Codex): ${cx}. "effort" = "low"|"medium"|"high". Bueno implementando código preciso.
- opencode (open source, permite modelos de terceros): ${oc}. El "model" DEBE ser exactamente uno de
  esa lista (formato "provider/model"). opencode NO usa "effort" → effort=null.`;
}

function buildPrompt(desc: string, cat: Catalog | null, skillNames: string[]): string {
  const skillsLine = skillNames.length
    ? `\n- "skills": array (posiblemente vacío) con los nombres de skills de DOMINIO que le convienen a
  este agente. Elegí SOLO de esta lista (exactos, no inventes): ${skillNames.join(", ")}. Si ninguna
  aplica, usá []. No incluyas "ponytail" (ya va siempre).`
    : "";
  const skillsField = skillNames.length ? `, "skills": string[]` : "";
  return `Sos un configurador de agentes de IA para HyprDesk (un orquestador de agentes de código).
Dada la descripción de abajo, devolvé SOLO un objeto JSON válido (sin markdown, sin \`\`\`, sin texto extra) con EXACTAMENTE este shape:
{"name": string corto (2-4 palabras), "engine": "claude"|"codex"|"opencode", "model": string|null, "effort": "low"|"medium"|"high"|null, "persona": string (instrucciones detalladas en 2da persona: rol, arquitectura, endpoints/reglas específicas, criterios de calidad), "color": string hex "#rrggbb", "rules": {"canMerge": "always"|"ask"|"never"}${skillsField}}

${catalogText(cat)}

Reglas:
- El "model" TIENE que ser uno de los strings válidos de arriba para el motor elegido. Si el usuario pide
  un modelo que no está en la lista, elegí el más parecido de la lista (NO inventes strings).
- "effort" solo aplica a codex; para claude y opencode usá null.
- La "persona" debe ser detallada y accionable, no genérica.
- Si el usuario menciona merge/push a git, reflejalo en rules.canMerge Y explícitamente en la persona.${skillsLine}

Descripción del usuario:
"""${desc}"""

Devolvé SOLO el JSON.`;
}

// Extrae el objeto JSON de la respuesta del asistente (tolera fences y texto alrededor).
function parseProfile(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

const CloseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);

// Perfil en blanco para el modo manual (sin IA).
function blankProfile(): Profile {
  return { id: crypto.randomUUID(), name: "", engine: "claude", model: undefined, effort: undefined, persona: "", color: COLORS[0], rules: { canMerge: "ask" }, skills: [] };
}

export function CreateAgentModal({
  onClose, onSave, onSaveAndLaunch, canLaunch,
}: {
  onClose: () => void;
  onSave: (p: Profile) => void;
  onSaveAndLaunch: (p: Profile) => void;
  canLaunch: boolean;
}) {
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [desc, setDesc] = useState("");
  const [gen, setGen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<Profile | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => { invoke<Catalog>("list_models").then(setCat).catch(() => {}); }, []);
  useEffect(() => { invoke<SkillInfo[]>("list_skills").then(setSkills).catch(() => {}); }, []);

  // Cambiar de modo: manual arranca con un perfil en blanco (form directo); IA vuelve al describir.
  const switchMode = (m: "ai" | "manual") => {
    setMode(m); setError(null);
    if (m === "manual") setP((cur) => cur ?? blankProfile());
    else setP(null);
  };

  const generate = async () => {
    if (!desc.trim() || gen) return;
    setGen(true); setError(null);
    try {
      const skillNames = skills.map((s) => s.name);
      const raw = await invoke<string>("run_assistant", { prompt: buildPrompt(desc, cat, skillNames) });
      const o = parseProfile(raw);
      // solo aceptamos skills que existan de verdad (la IA a veces inventa)
      const picked = Array.isArray(o.skills) ? o.skills.filter((s: unknown) => typeof s === "string" && skillNames.includes(s)) : [];
      setP({
        id: crypto.randomUUID(),
        name: o.name || "Agente",
        engine: ["claude", "codex", "opencode"].includes(o.engine) ? o.engine : "claude",
        model: o.model || undefined,
        effort: o.effort || undefined,
        persona: o.persona || "",
        color: /^#[0-9a-f]{6}$/i.test(o.color || "") ? o.color : COLORS[0],
        rules: { canMerge: o.rules?.canMerge || "ask" },
        skills: picked,
      });
    } catch (e) {
      setError("No pude generar el perfil. Revisá el motor asistente en Configuración. " + String(e));
    } finally {
      setGen(false);
    }
  };

  const upd = (patch: Partial<Profile>) => setP((cur) => (cur ? { ...cur, ...patch } : cur));

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="modal__title">Crear agente</span>
          <div className="ca__modes">
            <button className={`ca__mode ${mode === "ai" ? "ca__mode--on" : ""}`} onClick={() => switchMode("ai")}>Con IA</button>
            <button className={`ca__mode ${mode === "manual" ? "ca__mode--on" : ""}`} onClick={() => switchMode("manual")}>Manual</button>
          </div>
          <button className="modal__close" onClick={onClose} title="Cerrar"><CloseIcon /></button>
        </div>

        {mode === "ai" && (
          <div className="modal__section">
            <div className="modal__hint">Describí el agente. El meta-agente (el CLI de Configuración) arma el perfil: motor, modelo, effort y persona. Es por-workspace.</div>
            <textarea
              className="ca__desc" value={desc} rows={4}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Ej: agente de backend, preciso pero no el más pesado, con instrucciones por endpoint y arquitectura; corre tests pero NUNCA mergea a git sin mi permiso."
            />
            <button className="modal__save" onClick={generate} disabled={gen || !desc.trim()}>{gen ? "Generando…" : "Generar perfil"}</button>
            {error && <div className="ca__error">{error}</div>}
          </div>
        )}

        {p && (
          <>
            <div className="modal__section ca__form">
              <label className="modal__field"><span>Nombre</span><input value={p.name} onChange={(e) => upd({ name: e.target.value })} /></label>
              <div className="ca__row">
                <label className="modal__field"><span>Motor</span>
                  <select value={p.engine} onChange={(e) => upd({ engine: e.target.value })}>
                    <option value="claude">Claude</option><option value="codex">Codex</option><option value="opencode">OpenCode</option>
                  </select>
                </label>
                <label className="modal__field"><span>Modelo</span><input value={p.model || ""} onChange={(e) => upd({ model: e.target.value || undefined })} placeholder="default" /></label>
                <label className="modal__field"><span>Effort</span>
                  <select value={p.effort || ""} onChange={(e) => upd({ effort: e.target.value || undefined })}>
                    <option value="">—</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
                  </select>
                </label>
              </div>
              <label className="modal__field"><span>Persona / instrucciones</span><textarea value={p.persona} rows={6} onChange={(e) => upd({ persona: e.target.value })} /></label>
              {skills.length > 0 && (
                <div className="modal__field"><span>Skills de dominio</span>
                  <div className="ca__skills">
                    {skills.map((s) => {
                      const on = (p.skills || []).includes(s.name);
                      return (
                        <button
                          key={s.name} type="button" title={s.summary}
                          className={`ca__skill ${on ? "ca__skill--on" : ""}`}
                          onClick={() => upd({ skills: on ? (p.skills || []).filter((x) => x !== s.name) : [...(p.skills || []), s.name] })}
                        >{s.name}</button>
                      );
                    })}
                  </div>
                  <div className="modal__hint">Se inyectan en este agente al lanzarlo (además de Ponytail y las default-on).</div>
                </div>
              )}
              <div className="ca__row">
                <label className="modal__field"><span>Puede mergear a git</span>
                  <select value={p.rules?.canMerge || "ask"} onChange={(e) => upd({ rules: { canMerge: e.target.value as any } })}>
                    <option value="always">siempre</option><option value="ask">con permiso</option><option value="never">nunca</option>
                  </select>
                </label>
                <div className="modal__field"><span>Color</span>
                  <div className="ca__colors">
                    {COLORS.map((c) => (
                      <button key={c} className={`ca__color ${p.color === c ? "ca__color--on" : ""}`} style={{ background: c }} onClick={() => upd({ color: c })} title={c} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal__foot ca__foot">
              <button className="modal__ghost" disabled={!p.name.trim()} onClick={() => { onSave(p); onClose(); }}>Guardar</button>
              <button className="modal__save" disabled={!canLaunch || !p.name.trim()} title={canLaunch ? "" : "Necesitás un router en el workspace"} onClick={() => { onSaveAndLaunch(p); onClose(); }}>Guardar y lanzar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
