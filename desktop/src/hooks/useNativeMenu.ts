// Menú nativo de macOS: el backend emite "menu"<action>. Se rutea por runMenuAction (mismo dispatch
// que el menú custom del titlebar en Windows/Linux).
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { runMenuAction } from "../commands/menuActions";

export function useNativeMenu() {
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<string>("menu", (e) => runMenuAction(e.payload)).then((u) => { un = u; });
    return () => un?.();
  }, []);
}
