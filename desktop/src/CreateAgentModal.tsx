import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Profile } from "./App";

const COLORS = ["#34d399", "#60a5fa", "#c084fc", "#fbbf24", "#f87171", "#22d3ee", "#f472b6", "#a3e635"];

const CATALOG = `Motores y modelos disponibles:
- claude (Claude Code): modelos "opus" (más potente), "sonnet" (balanceado), "haiku" (rápido). Sin "effort". Muy fuerte en razonamiento, arquitectura y salida estructurada.
- codex (OpenAI Codex): modelos "gpt-5.6-terra" (potente/preciso), "gpt-5.6-sol" (más rápido); "effort" = "low" | "medium" | "high". Muy bueno implementando código preciso.
- opencode: formato "provider/model" (ej. "anthropic/claude-sonnet-4-6"). Flexible.`;

function buildPrompt(desc: string): string {
  return `Sos un configurador de agentes de IA para HyprDesk (un orquestador de agentes de código).
Dada la descripción de abajo, devolvé SOLO un objeto JSON válido (sin markdown, sin \`\`\`, sin texto extra) con EXACTAMENTE este shape:
{"name": string corto (2-4 palabras), "engine": "claude"|"codex"|"opencode", "model": string|null, "effort": "low"|"medium"|"high"|null, "persona": string (instrucciones detalladas en 2da persona: rol, arquitectura, endpoints/reglas específicas, criterios de calidad), "color": string hex "#rrggbb", "rules": {"canMerge": "always"|"ask"|"never"}}

${CATALOG}

Reglas:
- Elegí motor+modelo+effort acordes ("preciso pero no el más pesado" ≈ codex gpt-5.6-terra/high o gpt-5.6-sol/high; "razonamiento/arquitectura" ≈ claude sonnet/opus).
- La "persona" debe ser detallada y accionable, no genérica.
- Si el usuario menciona merge/push a git, reflejalo en rules.canMerge Y explícitamente en la persona.
- "effort" solo aplica a codex; para claude/opencode usá null.

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

export function CreateAgentModal({
  onClose, onSave, onSaveAndLaunch, canLaunch,
}: {
  onClose: () => void;
  onSave: (p: Profile) => void;
  onSaveAndLaunch: (p: Profile) => void;
  canLaunch: boolean;
}) {
  const [desc, setDesc] = useState("");
  const [gen, setGen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<Profile | null>(null);

  const generate = async () => {
    if (!desc.trim() || gen) return;
    setGen(true); setError(null);
    try {
      const raw = await invoke<string>("run_assistant", { prompt: buildPrompt(desc) });
      const o = parseProfile(raw);
      setP({
        id: crypto.randomUUID(),
        name: o.name || "Agente",
        engine: ["claude", "codex", "opencode"].includes(o.engine) ? o.engine : "claude",
        model: o.model || undefined,
        effort: o.effort || undefined,
        persona: o.persona || "",
        color: /^#[0-9a-f]{6}$/i.test(o.color || "") ? o.color : COLORS[0],
        rules: { canMerge: o.rules?.canMerge || "ask" },
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
          <span className="modal__title">Crear agente con IA</span>
          <button className="modal__close" onClick={onClose} title="Cerrar"><CloseIcon /></button>
        </div>

        <div className="modal__section">
          <div className="modal__hint">Describí el agente. El meta-agente (el CLI de Configuración) arma el perfil: motor, modelo, effort y persona. Es por-workspace.</div>
          <textarea
            className="ca__desc" value={desc} rows={4}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Ej: agente de backend, preciso pero no el más pesado, con instrucciones por endpoint y arquitectura; corre tests pero NUNCA mergea a git sin mi permiso."
          />
          <button className="modal__save" onClick={generate} disabled={gen || !desc.trim()}>{gen ? "Generando…" : "Generar perfil ✨"}</button>
          {error && <div className="ca__error">{error}</div>}
        </div>

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
              <button className="modal__ghost" onClick={() => { onSave(p); onClose(); }}>Guardar</button>
              <button className="modal__save" disabled={!canLaunch} title={canLaunch ? "" : "Necesitás un router en el workspace"} onClick={() => { onSaveAndLaunch(p); onClose(); }}>Guardar y lanzar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
