// index.mjs — registry de adapters. Agregar un agente nuevo = un archivo + una línea acá.
import claude from "./claude.mjs";
import codex from "./codex.mjs";
import opencode from "./opencode.mjs";

export const adapters = { claude, codex, opencode };

export function getAdapter(name) {
  const a = adapters[name];
  if (!a) {
    throw new Error(`Adapter desconocido: "${name}". Disponibles: ${Object.keys(adapters).join(", ")}`);
  }
  return a;
}
