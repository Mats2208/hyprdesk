// keys.ts — teclas modificadas en la terminal (Shift+Enter y compañía).
//
// EL PROBLEMA: xterm manda "\r" para Enter Y para Shift+Enter (se come el modificador), así que el
// agente ve un Enter normal y ENVÍA el mensaje en vez de hacer un salto de línea.
//
// LA SOLUCIÓN: no hardcodear por motor, sino hablar el mismo idioma que las terminales donde esto
// ya funciona (Kitty, Ghostty, WezTerm): el "kitty keyboard protocol". La app pregunta si lo
// soportamos, nosotros contestamos, y a partir de ahí recibe las teclas desambiguadas. Codex y
// OpenCode lo negocian solos. Claude Code no lo usa, así que para él caemos a ESC+CR, que es
// exactamente lo que interpreta como salto de línea (es su Option+Enter, y lo que `claude
// /terminal-setup` configura en iTerm2 / VS Code).
import type { Terminal } from "@xterm/xterm";

// Bits de modificador del protocolo. El valor que va en la secuencia es la suma + 1.
const SHIFT = 1;
const ALT = 2;
const CTRL = 4;

export type KittyState = { level: number };

const first = (p: (number | number[])[]): number => {
  const v = p[0];
  const n = Array.isArray(v) ? v[0] : v;
  return typeof n === "number" && n > 0 ? n : 0;
};

// Instala la negociación del protocolo. Devuelve el estado vivo que después consulta encodeKey.
export function installKittyKeyboard(term: Terminal, write: (data: string) => void): KittyState {
  const state: KittyState = { level: 0 };
  const stack: number[] = [];

  // CSI ? u → "¿soportás el protocolo?". Responder YA significa que sí (el silencio significa que no).
  term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
    write(`\x1b[?${state.level}u`);
    return true;
  });
  // CSI > flags u → la app ACTIVA el protocolo (push). Claude Code lo manda a ciegas, sin preguntar:
  // arranca con `CSI < u` (pop) y `CSI > 1 u` (push flags=1, "disambiguate"). Verificado sondeando
  // el binario real: con flags=1 acepta CSI 13;2u como salto de línea y NO envía el mensaje.
  term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
    stack.push(state.level);
    state.level = first(params); // flags=0 = protocolo apagado → NO forzamos un nivel (caemos a ESC+CR)
    return true;
  });
  // CSI < u → la app lo desactiva al salir (pop).
  term.parser.registerCsiHandler({ prefix: "<", final: "u" }, () => {
    state.level = stack.pop() ?? 0;
    return true;
  });
  // CSI = flags ; mode u → set directo.
  term.parser.registerCsiHandler({ prefix: "=", final: "u" }, (params) => {
    state.level = first(params);
    return true;
  });

  return state;
}

// Secuencia a mandar por una tecla con modificadores, o null si xterm la maneja bien solo.
// Hoy: Enter + (Shift | Alt | Ctrl) → salto de línea en vez de enviar el mensaje.
export function encodeKey(e: KeyboardEvent, kitty: KittyState): string | null {
  if (e.key !== "Enter") return null;
  const mods = (e.shiftKey ? SHIFT : 0) | (e.altKey ? ALT : 0) | (e.ctrlKey ? CTRL : 0);
  if (mods === 0) return null; // Enter pelado = enviar. Es el comportamiento correcto: no lo tocamos.
  // El agente activó el protocolo (codex/opencode) → mandamos la tecla desambiguada.
  if (kitty.level > 0) return `\x1b[13;${mods + 1}u`;
  // Sin protocolo (claude) → ESC+CR: salto de línea sin enviar.
  return "\x1b\r";
}
