// Registro central de comandos. Toda acción invocable (paleta, atajos, menú nativo) se define una vez
// acá y se referencia por id — nunca se llama al handler directo. Base para keybindings remapeables (E6).
export type Command = {
  id: string;
  title: string;
  category: string;
  keybinding?: string; // etiqueta para mostrar (ej. "⌘T"); el binding real vive en useKeyboard
  when?: () => boolean; // habilitación/visibilidad (opcional)
  run: () => void;
};

const registry = new Map<string, Command>();

export function registerCommand(c: Command) { registry.set(c.id, c); }
export function registerCommands(cs: Command[]) { cs.forEach(registerCommand); }
export function listCommands(): Command[] { return [...registry.values()]; }
export function getCommand(id: string): Command | undefined { return registry.get(id); }

// Ejecuta un comando por id, respetando su `when` si lo tiene.
export function runCommand(id: string) {
  const c = registry.get(id);
  if (c && (!c.when || c.when())) c.run();
}
