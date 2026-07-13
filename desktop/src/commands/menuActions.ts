// Dispatch de las acciones de menú, compartido por el menú nativo de macOS (useNativeMenu) y el
// menú custom del titlebar frameless en Windows/Linux (TitleMenu). Camino único: casi todo rutea al
// registro de comandos; "open-folder" abre un diálogo del SO y "new-window" invoca al backend.
import { invoke } from "@tauri-apps/api/core";
import { runCommand } from "./registry";
import { useSessionStore } from "../store/sessionStore";
import { pickFolderAsWorkspace } from "../store/workspaces";

const MENU_TO_COMMAND: Record<string, string> = {
  "new-workspace": "panel-workspaces",
  "close-workspace": "close-ws",
  "toggle-sidebar": "toggle-sidebar",
  "palette": "toggle-palette",
  "settings": "settings",
};

export function runMenuAction(action: string) {
  if (action === "open-folder") {
    pickFolderAsWorkspace()
      .then((meta) => { if (meta) useSessionStore.getState().openWorkspace(meta); })
      .catch(() => {});
    return;
  }
  if (action === "new-window") { invoke("new_window").catch(() => {}); return; }
  const id = MENU_TO_COMMAND[action];
  if (id) runCommand(id);
}
