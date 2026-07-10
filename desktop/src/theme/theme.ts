// Tema de la app: aplica data-theme en el root y lo persiste. Los tokens viven en App.css.
import { useState } from "react";

export type ThemeName = "dark" | "light" | "hc";
export const THEMES: ThemeName[] = ["dark", "light", "hc"];
export const THEME_LABEL: Record<ThemeName, string> = { dark: "Oscuro", light: "Claro", hc: "Alto contraste" };

const KEY = "hd-theme";

export function getTheme(): ThemeName {
  const t = localStorage.getItem(KEY);
  return t === "light" || t === "hc" ? t : "dark";
}

export function applyTheme(t: ThemeName) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(KEY, t);
}

// Aplicar antes del primer render (en main.tsx) para evitar el flash de tema.
export function initTheme() { applyTheme(getTheme()); }

// Hook para el toggle: tema actual + setter + ciclo dark → light → hc.
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(getTheme);
  const setTheme = (t: ThemeName) => { applyTheme(t); setThemeState(t); };
  const cycle = () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
  return { theme, setTheme, cycle };
}
