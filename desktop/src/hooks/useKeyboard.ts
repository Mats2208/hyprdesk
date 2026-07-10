// Atajos globales → despachan comandos por id, resolviendo desde los bindings remapeables.
// Se lee getBindings() en cada tecla (evento raro) → los remaps aplican al instante.
import { useEffect } from "react";
import { runCommand } from "../commands/registry";
import { eventToCombo, getBindings } from "../commands/keybindings";
import { useSessionStore } from "../store/sessionStore";

// alias verticales fijos (no remapeables): equivalen a las flechas horizontales.
const ALIAS: Record<string, string> = { "mod+arrowdown": "focus-next", "mod+arrowup": "focus-prev" };

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useSessionStore.getState().stage !== "ide") return;
      const combo = eventToCombo(e);
      if (!combo) return;
      const bindings = getBindings();
      const id = Object.keys(bindings).find((cid) => bindings[cid] === combo) ?? ALIAS[combo];
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      runCommand(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
