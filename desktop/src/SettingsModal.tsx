import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Assistant = { engine: string; model?: string | null; effort?: string | null };
type Settings = { assistant: Assistant; permissionMode?: string };

const ENGINES = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
];

// Configuración global de HyprDesk. Por ahora: el "asistente" — el CLI que la app usa para sus
// features de IA (generar perfiles de agentes, etc.), NO para escribir código.
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [engine, setEngine] = useState("claude");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [permission, setPermission] = useState("auto");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<Settings>("load_settings")
      .then((s) => {
        setEngine(s.assistant?.engine ?? "claude");
        setModel(s.assistant?.model ?? "");
        setEffort(s.assistant?.effort ?? "");
        setPermission(s.permissionMode === "ask" ? "ask" : "auto");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    const settings: Settings = {
      assistant: { engine, model: model.trim() || null, effort: effort.trim() || null },
      permissionMode: permission,
    };
    try {
      await invoke("save_settings", { settings });
      setSaved(true);
      setTimeout(onClose, 600);
    } catch { /* ignore */ }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="modal__title">Configuración</span>
          <button className="modal__close" onClick={onClose} title="Cerrar">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="modal__section">
          <div className="modal__label">Asistente de IA de HyprDesk</div>
          <div className="modal__hint">El CLI que la app usa para sus propias features de IA (generar agentes, consultas). No es para escribir código.</div>
          <div className="modal__engines">
            {ENGINES.map((e) => (
              <button key={e.id} className={`modal__engine ${engine === e.id ? "modal__engine--on" : ""}`} onClick={() => setEngine(e.id)}>
                {e.label}
              </button>
            ))}
          </div>
          <label className="modal__field">
            <span>Modelo (opcional)</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default del CLI" />
          </label>
          {engine === "codex" && (
            <label className="modal__field">
              <span>Effort (opcional)</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                <option value="">default</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
          )}
        </div>

        <div className="modal__section" style={{ borderTop: "1px solid var(--hairline)" }}>
          <div className="modal__label">Modo de permisos de los agentes</div>
          <div className="modal__hint">Cómo trabajan router y workers. Aplica a los agentes que lances DESPUÉS de guardar.</div>
          <div className="modal__engines">
            <button className={`modal__engine ${permission === "auto" ? "modal__engine--on" : ""}`} onClick={() => setPermission("auto")}>
              ⚡ Autónomo
            </button>
            <button className={`modal__engine ${permission === "ask" ? "modal__engine--on" : ""}`} onClick={() => setPermission("ask")}>
              ✋ Preguntar
            </button>
          </div>
          <div className="modal__hint">
            {permission === "auto"
              ? "Autónomo (bypass): los agentes editan y corren comandos sin pedir aprobación. Más rápido; ideal si confiás y querés que fluya solo."
              : "Preguntar: cada agente pide tu aprobación antes de editar o correr comandos. Más lento, pero podés revisar todo (claude: prompts · codex: on-request · opencode: ask)."}
          </div>
        </div>
        <div className="modal__foot">
          <button className="modal__save" onClick={save}>{saved ? "Guardado ✓" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}
