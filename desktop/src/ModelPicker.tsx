// Selector de modelo dependiente del MOTOR: en vez de texto libre (que no sabe qué modelos son
// válidos), muestra un dropdown con los modelos reales del motor elegido (claude/codex/opencode,
// vía el comando list_models) + un escape "Otro…" para pegar un ID exacto que no esté en la lista.
// El padre debe remontarlo al cambiar de motor (key={engine}) para re-derivar el estado.
import { useState } from "react";

export type ModelCatalog = { claude: string[]; codex: string[]; opencode: string[] };

export function ModelPicker({ engine, catalog, value, onChange, cls }: {
  engine: string;
  catalog: ModelCatalog | null;
  value: string;
  onChange: (v: string) => void;
  cls?: string; // clase de input/select según el contexto (settings vs modal)
}) {
  const models = (catalog?.[engine as keyof ModelCatalog] ?? []) as string[];
  const [manual, setManual] = useState(false);
  // "custom" si el usuario lo pidió, o si hay un valor que no está en la lista del motor.
  const showCustom = manual || (value !== "" && !models.includes(value));

  return (
    <div className="modelpick">
      <select
        className={cls} value={showCustom ? "__custom__" : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") setManual(true);
          else { setManual(false); onChange(v); }
        }}
      >
        <option value="">default del CLI</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
        <option value="__custom__">Otro (escribir ID)…</option>
      </select>
      {showCustom && (
        <input
          className={cls} value={value} autoFocus spellCheck={false} autoCapitalize="off" autoCorrect="off"
          placeholder="ID exacto del modelo (ej. anthropic/claude-… o provider/model)"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
