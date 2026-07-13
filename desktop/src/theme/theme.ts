// Tema + tipografía de la app (una sola fuente de verdad, reactiva). Aplica a los tokens CSS del root
// y persiste en localStorage. La terminal (xterm) y el editor (CodeMirror) se suscriben para reaccionar.
import { create } from "zustand";

export type ThemeName = "dark" | "light" | "hc";
export const THEMES: ThemeName[] = ["dark", "light", "hc"];
export const THEME_LABEL: Record<ThemeName, string> = { dark: "Oscuro", light: "Claro", hc: "Alto contraste" };

const K = { theme: "hd-theme", ui: "hd-font-ui", mono: "hd-font-mono", term: "hd-fs-term" };
const num = (v: string | null, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const isTheme = (v: string | null): v is ThemeName => v === "light" || v === "hc" || v === "dark";

// Aplica al DOM. Fuente vacía → se quita el override y manda el default del CSS.
function applyToDom(s: { theme: ThemeName; uiFont: string; monoFont: string }) {
  const root = document.documentElement;
  root.setAttribute("data-theme", s.theme);
  if (s.uiFont.trim()) root.style.setProperty("--font-ui", s.uiFont); else root.style.removeProperty("--font-ui");
  if (s.monoFont.trim()) root.style.setProperty("--font-mono", s.monoFont); else root.style.removeProperty("--font-mono");
}

type ThemeState = {
  theme: ThemeName;
  uiFont: string;   // "" = default del CSS
  monoFont: string; // "" = default del CSS
  termFontSize: number;
  setTheme: (t: ThemeName) => void;
  cycleTheme: () => void;
  setUiFont: (f: string) => void;
  setMonoFont: (f: string) => void;
  setTermFontSize: (n: number) => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (isTheme(localStorage.getItem(K.theme)) ? (localStorage.getItem(K.theme) as ThemeName) : "dark"),
  uiFont: localStorage.getItem(K.ui) ?? "",
  monoFont: localStorage.getItem(K.mono) ?? "",
  termFontSize: num(localStorage.getItem(K.term), 12.5),

  // OJO: applyToDom ANTES de set(): set() dispara los subscribers (xterm/CodeMirror) que leen los
  // CSS vars con getComputedStyle; si data-theme aún no cambió, leerían los colores viejos (bug de
  // "la consola no cambia en light mode").
  setTheme: (theme) => { localStorage.setItem(K.theme, theme); applyToDom({ ...get(), theme }); set({ theme }); },
  cycleTheme: () => get().setTheme(THEMES[(THEMES.indexOf(get().theme) + 1) % THEMES.length]),
  setUiFont: (uiFont) => { localStorage.setItem(K.ui, uiFont); applyToDom({ ...get(), uiFont }); set({ uiFont }); },
  setMonoFont: (monoFont) => { localStorage.setItem(K.mono, monoFont); applyToDom({ ...get(), monoFont }); set({ monoFont }); },
  setTermFontSize: (termFontSize) => { localStorage.setItem(K.term, String(termFontSize)); set({ termFontSize }); },
}));

// Aplicar antes del primer render (main.tsx) para evitar el flash de tema/fuente.
export function initTheme() { applyToDom(useThemeStore.getState()); }
