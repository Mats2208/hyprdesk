// Lee los tokens CSS vigentes (según data-theme) para construir los temas de xterm y CodeMirror,
// que necesitan valores concretos (no CSS vars). Se re-lee cuando cambia el tema/fuente.
const cssVar = (n: string, fallback = "") =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fallback;

const isLight = () => document.documentElement.getAttribute("data-theme") === "light";

// Paletas ANSI: en claro los tonos son más oscuros para leerse sobre fondo claro.
const DARK_ANSI = {
  // Paleta del terminal integrado de VS Code (Dark Modern) — sobria, no neón.
  black: "#000000", brightBlack: "#666666", green: "#0dbc79", brightGreen: "#23d18b",
  blue: "#2472c8", cyan: "#11a8cd", yellow: "#e5e510", red: "#cd3131",
  magenta: "#bc3fbc", white: "#e5e5e5", brightWhite: "#ffffff",
};
const LIGHT_ANSI = {
  black: "#000000", brightBlack: "#666666", green: "#00bc00", brightGreen: "#14ce14",
  blue: "#0451a5", cyan: "#0598bc", yellow: "#949800", red: "#cd3131",
  magenta: "#bc05bc", white: "#555555", brightWhite: "#a5a5a5",
};

export const monoFont = () => cssVar("--font-mono", 'ui-monospace, "SF Mono", monospace');

// Tema para xterm.js desde los tokens (router → cursor con acento).
export function xtermTheme(isRouter: boolean) {
  const bg = cssVar("--tile-bg", "#0e0e10");
  return {
    background: bg,
    foreground: cssVar("--text", "#e4e4e7"),
    cursor: isRouter ? cssVar("--router", "#34d399") : cssVar("--muted", "#a1a1aa"),
    cursorAccent: bg,
    selectionBackground: isLight() ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.14)",
    ...(isLight() ? LIGHT_ANSI : DARK_ANSI),
  };
}

// Colores base para el tema de CodeMirror.
export function editorTokens() {
  return {
    bg: cssVar("--tile-bg", "#0e0e10"),
    text: cssVar("--text", "#e4e4e7"),
    muted: cssVar("--muted", "#8a8a92"),
    faint: cssVar("--faint", "#5c5c63"),
    accent: cssVar("--router", "#34d399"),
    hairline: cssVar("--hairline", "#26262a"),
    selection: isLight() ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.10)",
    mono: monoFont(),
    light: isLight(),
  };
}
