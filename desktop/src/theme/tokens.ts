// Lee los tokens CSS vigentes (según data-theme) para construir los temas de xterm y CodeMirror,
// que necesitan valores concretos (no CSS vars). Se re-lee cuando cambia el tema/fuente.
const cssVar = (n: string, fallback = "") =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fallback;

const isLight = () => document.documentElement.getAttribute("data-theme") === "light";

// Paletas ANSI: Steel Noir — 16 colores desaturados en UNA banda fría (nada satura ni vibra).
// En claro, los tonos bajan de luz para leerse sobre fondo claro.
const DARK_ANSI = {
  black: "#2b3038", brightBlack: "#5c6470",
  red: "#cf7e75", brightRed: "#dd9187",
  green: "#83b58b", brightGreen: "#9ac9a1",
  yellow: "#d3b579", brightYellow: "#e0c58d",
  blue: "#79a2c9", brightBlue: "#93b6d6",
  magenta: "#b28fb0", brightMagenta: "#c5a4c3",
  cyan: "#85c3cd", brightCyan: "#9fd2da",
  white: "#cfd3da", brightWhite: "#eceef2",
};
const LIGHT_ANSI = {
  black: "#1c1f24", brightBlack: "#5c616a",
  red: "#b0524a", brightRed: "#c26258",
  green: "#4f8a58", brightGreen: "#5c9a64",
  yellow: "#97771f", brightYellow: "#a8842a",
  blue: "#3f6885", brightBlue: "#4a769a",
  magenta: "#8a5a86", brightMagenta: "#9c6a97",
  cyan: "#3f8a94", brightCyan: "#4a9aa4",
  white: "#55585f", brightWhite: "#383a3f",
};

export const monoFont = () => cssVar("--font-mono", 'ui-monospace, "SF Mono", monospace');

// Tema para xterm.js desde los tokens (router → cursor con acento).
export function xtermTheme(isRouter: boolean) {
  const bg = cssVar("--tile-bg", "#16191e");
  return {
    background: bg,
    foreground: cssVar("--text", "#cfd3da"),
    cursor: isRouter ? cssVar("--router", "#6f9dc0") : cssVar("--muted", "#8b909b"),
    cursorAccent: bg,
    // Selección tintada con el acento (no el azul del SO / gris plano).
    selectionBackground: isLight() ? "rgba(63,104,133,0.20)" : "rgba(111,157,192,0.24)",
    ...(isLight() ? LIGHT_ANSI : DARK_ANSI),
  };
}
