// Lee los tokens CSS vigentes (según data-theme) para construir los temas de xterm y CodeMirror,
// que necesitan valores concretos (no CSS vars). Se re-lee cuando cambia el tema/fuente.
const cssVar = (n: string, fallback = "") =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fallback;

const isLight = () => document.documentElement.getAttribute("data-theme") === "light";

// Paletas ANSI: en claro los tonos son más oscuros para leerse sobre fondo claro.
const DARK_ANSI = {
  black: "#18181b", brightBlack: "#52525b", green: "#34d399", brightGreen: "#6ee7b7",
  blue: "#60a5fa", cyan: "#22d3ee", yellow: "#fbbf24", red: "#f87171",
  magenta: "#c084fc", white: "#d4d4d8", brightWhite: "#fafafa",
};
const LIGHT_ANSI = {
  black: "#1c1c1f", brightBlack: "#6b6b73", green: "#0ea56f", brightGreen: "#0b8a5c",
  blue: "#2563eb", cyan: "#0891b2", yellow: "#b45309", red: "#dc2626",
  magenta: "#9333ea", white: "#3f3f46", brightWhite: "#18181b",
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
