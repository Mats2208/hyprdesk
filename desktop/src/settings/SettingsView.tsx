// Panel de configuración auto-generado desde el schema: buscable, por categorías. Reemplaza el modal.
// Rutea cada opción a su backend según scope: theme (store), backend (settings.json), local (localStorage).
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CATEGORIES, SCHEMA, type Field } from "./schema";
import { ProvidersSection } from "./ProvidersSection";
import { KeybindingsSection } from "./KeybindingsSection";
import { useThemeStore } from "../theme/theme";

const SPECIAL = new Set(["Proveedores y API keys", "Atajos"]); // categorías con sección extra (no solo schema)

type Settings = { assistant: { engine: string; model?: string | null; effort?: string | null }; permissionMode?: string; zaiApiKey?: string | null };
type Backend = { assistantEngine: string; assistantModel: string; assistantEffort: string; permissionMode: string; zaiApiKey: string };
const EMPTY: Backend = { assistantEngine: "claude", assistantModel: "", assistantEffort: "", permissionMode: "auto", zaiApiKey: "" };

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(CATEGORIES[0]);
  const [backend, setBackend] = useState<Backend>(EMPTY);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const theme = useThemeStore();

  useEffect(() => {
    invoke<Settings>("load_settings").then((s) => setBackend({
      assistantEngine: s.assistant?.engine ?? "claude",
      assistantModel: s.assistant?.model ?? "",
      assistantEffort: s.assistant?.effort ?? "",
      permissionMode: s.permissionMode === "ask" ? "ask" : "auto",
      zaiApiKey: s.zaiApiKey ?? "",
    })).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lee el valor actual de una opción según su scope.
  const read = (key: string): string => {
    const f = SCHEMA.find((x) => x.key === key);
    if (f?.scope === "theme") {
      const v = (theme as unknown as Record<string, unknown>)[key];
      return typeof v === "number" ? String(v) : String(v ?? "");
    }
    return (backend as unknown as Record<string, string>)[key] ?? "";
  };

  // Escribe una opción según su scope (theme → store; backend → settings.json debounced).
  const write = (f: Field, val: string) => {
    if (f.scope === "theme") {
      const s = useThemeStore.getState();
      if (f.key === "theme") s.setTheme(val as "dark" | "light" | "hc");
      else if (f.key === "uiFont") s.setUiFont(val);
      else if (f.key === "monoFont") s.setMonoFont(val);
      else if (f.key === "termFontSize") s.setTermFontSize(Number(val) || 12.5);
      else if (f.key === "editorFontSize") s.setEditorFontSize(Number(val) || 12.5);
      return;
    }
    const next = { ...backend, [f.key]: val } as Backend;
    setBackend(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const settings: Settings = {
        assistant: { engine: next.assistantEngine, model: next.assistantModel.trim() || null, effort: next.assistantEffort.trim() || null },
        permissionMode: next.permissionMode,
        zaiApiKey: next.zaiApiKey.trim() || null,
      };
      invoke("save_settings", { settings }).catch(() => {});
    }, 400);
  };

  // Campos visibles: por búsqueda (todas las categorías) o por categoría activa.
  const fields = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const match = (f: Field) => !ql || `${f.label} ${f.description ?? ""} ${f.category}`.toLowerCase().includes(ql);
    return SCHEMA.filter((f) => (ql ? match(f) : f.category === cat) && (!f.visibleWhen || f.visibleWhen(read)));
  }, [q, cat, backend, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = q ? CATEGORIES.filter((c) => fields.some((f) => f.category === c)) : [cat];
  const showEmpty = fields.length === 0 && !(!q && SPECIAL.has(cat));

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings__head">
          <span className="settings__title">Configuración</span>
          <input className="settings__search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ajustes…" />
          <button className="modal__close" onClick={onClose} title="Cerrar (Esc)">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="settings__body">
          <nav className="settings__nav">
            {CATEGORIES.map((c) => (
              <button key={c} className={`settings__navitem ${!q && cat === c ? "settings__navitem--on" : ""}`} onClick={() => { setQ(""); setCat(c); }}>{c}</button>
            ))}
          </nav>
          <div className="settings__main">
            {showEmpty && <div className="settings__empty">Sin resultados</div>}
            {cats.map((c) => (
              <section key={c} className="settings__group">
                {q && <div className="settings__cat">{c}</div>}
                {fields.filter((f) => f.category === c).map((f) => (
                  <div key={f.key} className="settings__field">
                    <div className="settings__flabel">{f.label}</div>
                    {f.description && <div className="settings__fdesc">{f.description}</div>}
                    <Control field={f} value={read(f.key)} onChange={(v) => write(f, v)} />
                  </div>
                ))}
                {c === "Proveedores y API keys" && <ProvidersSection />}
                {c === "Atajos" && <KeybindingsSection />}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Control({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  if (f.type === "segmented") {
    return (
      <div className="settings__seg">
        {f.options?.map((o) => (
          <button key={o.value} className={`settings__segbtn ${value === o.value ? "settings__segbtn--on" : ""}`} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    );
  }
  if (f.type === "select") {
    return (
      <select className="settings__input" value={value} onChange={(e) => onChange(e.target.value)}>
        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.type === "number") {
    return <input className="settings__input settings__input--sm" type="number" value={value} min={f.min} max={f.max} step={f.step} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input className="settings__input" type={f.type === "password" ? "password" : "text"} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
}
