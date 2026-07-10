// Proveedores/API keys definidos por el usuario. Por ahora solo se guardan local (el consumo por los
// agentes es una etapa de backend futura). Lista editable: nombre + key.
import { useState } from "react";
import { loadProviders, saveProviders, type Provider } from "./providers";

export function ProvidersSection() {
  const [list, setList] = useState<Provider[]>(loadProviders);

  const update = (next: Provider[]) => { setList(next); saveProviders(next); };
  const add = () => update([...list, { id: crypto.randomUUID(), label: "", key: "" }]);
  const edit = (id: string, patch: Partial<Provider>) => update(list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string) => update(list.filter((p) => p.id !== id));

  return (
    <div className="settings__field">
      <div className="settings__flabel">Otros proveedores</div>
      <div className="settings__fdesc">Guardá keys de otros proveedores (OpenAI, OpenRouter, etc.). Por ahora solo se almacenan localmente — el uso por los agentes llega en una etapa próxima.</div>
      <div className="providers">
        {list.length === 0 && <div className="providers__empty">Sin proveedores. Agregá uno ↓</div>}
        {list.map((p) => (
          <div key={p.id} className="providers__row">
            <input className="settings__input providers__label" value={p.label} placeholder="nombre (ej. OpenAI)" onChange={(e) => edit(p.id, { label: e.target.value })} />
            <input className="settings__input providers__key" type="password" value={p.key} placeholder="API key" onChange={(e) => edit(p.id, { key: e.target.value })} />
            <button className="providers__del" title="Eliminar" onClick={() => remove(p.id)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          </div>
        ))}
        <button className="providers__add" onClick={add}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Agregar proveedor
        </button>
      </div>
    </div>
  );
}
