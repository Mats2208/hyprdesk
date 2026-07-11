// Dispatch de las acciones de menú, compartido por el menú nativo de macOS (useNativeMenu) y el
// menú custom del titlebar frameless en Windows/Linux (TitleMenu). Camino único: casi todo rutea al
// registro de comandos; "open-folder" abre un diálogo del SO y "new-window" invoca al backend.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { WorkspaceMeta } from "../WorkspaceManager";
import { runCommand } from "./registry";
import { useSessionStore } from "../store/sessionStore";

const MENU_TO_COMMAND: Record<string, string> = {
  "new-workspace": "panel-workspaces",
  "close-workspace": "close-ws",
  "toggle-sidebar": "toggle-sidebar",
  "palette": "toggle-palette",
  "settings": "settings",
};

export function runMenuAction(action: string) {
  if (action === "open-folder") {
    open({ directory: true, multiple: false, title: "Abrir carpeta como workspace" })
      .then((picked) => (picked && typeof picked === "string"
        ? invoke<WorkspaceMeta>("link_workspace", { folder: picked }) : undefined))
      .then((meta) => { if (meta) useSessionStore.getState().openWorkspace(meta); })
      .catch(() => {});
    return;
  }
  if (action === "new-window") { invoke("new_window").catch(() => {}); return; }
  const id = MENU_TO_COMMAND[action];
  if (id) runCommand(id);
}
