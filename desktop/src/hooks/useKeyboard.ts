// Atajos globales → despachan comandos por id (data-driven). Solo en el stage IDE. Requieren ⌘/Ctrl.
import { useEffect } from "react";
import { runCommand } from "../commands/registry";
import { useSessionStore } from "../store/sessionStore";

// mapa tecla (con ⌘/Ctrl) → id de comando. Cambiar acá cambia el atajo (base para remapeo en E6).
const KEYMAP: Record<string, string> = {
  t: "new-term",
  w: "close-tile",
  k: "toggle-palette",
  b: "toggle-sidebar",
  arrowright: "focus-next",
  arrowdown: "focus-next",
  arrowleft: "focus-prev",
  arrowup: "focus-prev",
};

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useSessionStore.getState().stage !== "ide") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const id = KEYMAP[e.key.toLowerCase()];
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      runCommand(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
