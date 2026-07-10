// Schema de settings: describe cada opción (tipo, categoría, ayuda) y de DÓNDE sale/va (scope).
// La SettingsView se auto-genera desde acá — agregar una opción es agregar una entrada.
export type FieldType = "segmented" | "select" | "text" | "password" | "number";
export type Scope = "theme" | "backend" | "local";
export type Option = { value: string; label: string };

export type Field = {
  key: string;
  label: string;
  description?: string;
  category: string;
  type: FieldType;
  scope: Scope;
  options?: Option[];
  placeholder?: string;
  min?: number; max?: number; step?: number;
  visibleWhen?: (get: (k: string) => string) => boolean;
};

export const CATEGORIES = ["Apariencia", "Terminal", "Editor", "Agentes y permisos", "Proveedores y API keys", "Atajos"];

export const SCHEMA: Field[] = [
  // — Apariencia (scope theme: store de tema) —
  { key: "theme", label: "Tema", category: "Apariencia", type: "segmented", scope: "theme",
    description: "Esquema de color de toda la app (incluye terminal y editor).",
    options: [{ value: "dark", label: "Oscuro" }, { value: "light", label: "Claro" }, { value: "hc", label: "Alto contraste" }] },
  { key: "uiFont", label: "Fuente de la interfaz", category: "Apariencia", type: "text", scope: "theme",
    description: "Familia tipográfica del chrome (menús, paneles). Vacío = fuente del sistema.", placeholder: "-apple-system, Inter, …" },
  { key: "monoFont", label: "Fuente monoespaciada", category: "Apariencia", type: "text", scope: "theme",
    description: "Familia usada en terminal, editor, chips y código. Vacío = default del sistema.", placeholder: "ui-monospace, JetBrains Mono, …" },

  // — Terminal / Editor (scope theme) —
  { key: "termFontSize", label: "Tamaño de fuente (terminal)", category: "Terminal", type: "number", scope: "theme",
    description: "Tamaño en px del texto de las terminales.", min: 8, max: 24, step: 0.5 },
  { key: "editorFontSize", label: "Tamaño de fuente (editor)", category: "Editor", type: "number", scope: "theme",
    description: "Tamaño en px del editor de código (CodeMirror).", min: 8, max: 24, step: 0.5 },

  // — Agentes y permisos (scope backend: ~/HyprDesk/settings.json) —
  { key: "assistantEngine", label: "Asistente de IA", category: "Agentes y permisos", type: "segmented", scope: "backend",
    description: "El CLI que HyprDesk usa para SUS features de IA (generar perfiles, consultas). No es para escribir código.",
    options: [{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex" }, { value: "opencode", label: "OpenCode" }] },
  { key: "assistantModel", label: "Modelo del asistente", category: "Agentes y permisos", type: "text", scope: "backend",
    description: "Modelo específico para el asistente. Vacío = default del CLI.", placeholder: "default del CLI" },
  { key: "assistantEffort", label: "Effort del asistente", category: "Agentes y permisos", type: "select", scope: "backend",
    description: "Solo aplica a Codex.", options: [{ value: "", label: "default" }, { value: "low", label: "low" }, { value: "medium", label: "medium" }, { value: "high", label: "high" }],
    visibleWhen: (get) => get("assistantEngine") === "codex" },
  { key: "permissionMode", label: "Modo de permisos", category: "Agentes y permisos", type: "segmented", scope: "backend",
    description: "Cómo trabajan router y workers que lances DESPUÉS de guardar. Autónomo = editan/corren sin pedir; Preguntar = piden aprobación.",
    options: [{ value: "auto", label: "Autónomo" }, { value: "ask", label: "Preguntar" }] },

  // — Proveedores y API keys —
  { key: "zaiApiKey", label: "z.ai (GLM) API key", category: "Proveedores y API keys", type: "password", scope: "backend",
    description: "Pegá tu key de z.ai para ver tu cuota (5h/semanal) en el header. Único proveedor con límites reales.", placeholder: "vacío = no mostrar" },
];
