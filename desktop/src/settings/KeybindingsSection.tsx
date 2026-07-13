// Editor de atajos: lista los comandos con binding y deja re-mapearlos (captura la próxima combinación).
import { useState } from "react";
import { getCommand } from "../commands/registry";
import { comboLabel, DEFAULT_BINDINGS, eventToCombo, getBindings, resetBinding, setBinding } from "../commands/keybindings";
import { isMac } from "../platform";

export function KeybindingsSection() {
  const [, force] = useState(0);
  const [recording, setRecording] = useState<string | null>(null);
  const bindings = getBindings();
  const rerender = () => force((n) => n + 1);

  const onKeyDown = (id: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    const combo = eventToCombo(e.nativeEvent);
    if (combo) { setBinding(id, combo); setRecording(null); rerender(); }
    else if (e.key === "Escape") setRecording(null);
  };

  return (
    <div className="settings__field">
      <div className="settings__flabel">Atajos de teclado</div>
      <div className="settings__fdesc">Clic en un atajo y presioná la nueva combinación (con {isMac ? "⌘" : "Ctrl"}). Esc para cancelar.</div>
      <div className="keybinds">
        {Object.keys(bindings).map((id) => {
          const cmd = getCommand(id);
          const changed = bindings[id] !== DEFAULT_BINDINGS[id];
          return (
            <div key={id} className="keybinds__row">
              <span className="keybinds__name">{cmd?.title ?? id}</span>
              <button
                className={`keybinds__key ${recording === id ? "keybinds__key--rec" : ""}`}
                onClick={() => setRecording(id)}
                onKeyDown={(e) => onKeyDown(id, e)}
              >
                {recording === id ? "presioná…" : comboLabel(bindings[id])}
              </button>
              {changed && (
                <button className="keybinds__reset" title="Restaurar default" onClick={() => { resetBinding(id); rerender(); }}>↺</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
