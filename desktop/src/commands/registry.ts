// Registro central de comandos. Toda acción invocable (paleta, atajos, menú nativo) se define una vez
// acá y se referencia por id — nunca se llama al handler directo. Base para keybindings remapeables (E6).
export type Command = {
  id: string;
  title: string;
  category: string;
  keybinding?: string; // etiqueta para mostrar (ej. "⌘T"); el binding real vive en useKeyboard
  run: () => void;
};

const registry = new Map<string, Command>();

export function registerCommands(cs: Command[]) { cs.forEach((c) => registry.set(c.id, c)); }
export function listCommands(): Command[] { return [...registry.values()]; }
export function getCommand(id: string): Command | undefined { return registry.get(id); }
export function runCommand(id: string) { registry.get(id)?.run(); }
