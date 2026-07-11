// Atajos remapeables: mapa commandId → combo ("mod+t"). Defaults + overrides del usuario (localStorage).
// useKeyboard resuelve el combo entrante a un comando; la Settings deja editarlos.
export type Combo = string;

export const DEFAULT_BINDINGS: Record<string, Combo> = {
  "new-term": "mod+t",
  "close-tile": "mod+w",
  "toggle-palette": "mod+k",
  "toggle-sidebar": "mod+b",
  "focus-next": "mod+arrowright",
  "focus-prev": "mod+arrowleft",
};

const K = "hd-keybinds";
const overrides = (): Record<string, Combo> => { try { return JSON.parse(localStorage.getItem(K) || "{}"); } catch { return {}; } };

export function getBindings(): Record<string, Combo> {
  return { ...DEFAULT_BINDINGS, ...overrides() };
}

export function setBinding(id: string, combo: Combo) {
  localStorage.setItem(K, JSON.stringify({ ...overrides(), [id]: combo }));
}

export function resetBinding(id: string) {
  const o = overrides(); delete o[id]; localStorage.setItem(K, JSON.stringify(o));
}

// combo → etiqueta legible, según el SO: en mac glifos compactos ("mod+t" → "⌘T"), en Windows/Linux
// texto con "+" ("mod+t" → "Ctrl+T"). El binding real es el mismo (mod = ⌘ en mac / Ctrl en el resto).
const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
const SYM: Record<string, string> = isMac
  ? { mod: "⌘", shift: "⇧", alt: "⌥", arrowright: "→", arrowleft: "←", arrowup: "↑", arrowdown: "↓" }
  : { mod: "Ctrl+", shift: "Shift+", alt: "Alt+", arrowright: "→", arrowleft: "←", arrowup: "↑", arrowdown: "↓" };
export function comboLabel(c: Combo): string {
  return c.split("+").map((p) => SYM[p] ?? p.toUpperCase()).join("");
}

// KeyboardEvent → combo. Requiere ⌘/Ctrl y una tecla no-modificadora; null si no aplica.
export function eventToCombo(e: KeyboardEvent): Combo | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  const k = e.key.toLowerCase();
  if (k === "meta" || k === "control" || k === "shift" || k === "alt") return null;
  return "mod+" + k;
}
