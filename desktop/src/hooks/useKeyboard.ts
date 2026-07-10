// Atajos globales (⌘T/⌘W/⌘K/⌘B + flechas). Despacha a los stores. Solo en el stage IDE.
import { useEffect } from "react";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ss = useSessionStore.getState();
      const us = useUiStore.getState();
      if (ss.stage !== "ide") return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); e.stopPropagation(); ss.addTerminal(); }
      else if (k === "w") { e.preventDefault(); e.stopPropagation(); const a = ss.current()?.activeId; if (a) ss.closeTerminal(a); }
      else if (k === "k") { e.preventDefault(); e.stopPropagation(); us.togglePalette(); }
      else if (k === "b") { e.preventDefault(); e.stopPropagation(); us.setSidebarOpen((o) => !o); }
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); ss.focusDelta(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); ss.focusDelta(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
