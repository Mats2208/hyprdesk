// Menú nativo de macOS: el backend emite "menu"<action>. Se rutea por el registro de comandos
// (camino único de dispatch); solo "open-folder" queda inline porque abre un diálogo del SO.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { WorkspaceMeta } from "../WorkspaceManager";
import { runCommand } from "../commands/registry";
import { useSessionStore } from "../store/sessionStore";

// acción del menú → id de comando equivalente.
const MENU_TO_COMMAND: Record<string, string> = {
  "new-workspace": "panel-workspaces",
  "close-workspace": "close-ws",
  "toggle-sidebar": "toggle-sidebar",
  "palette": "toggle-palette",
  "settings": "settings",
};

export function useNativeMenu() {
  useEffect(() => {
    let un: (() => void) | undefined;
    const dispatch = (action: string) => {
      if (action === "open-folder") {
        open({ directory: true, multiple: false, title: "Abrir carpeta como workspace" })
          .then((picked) => (picked && typeof picked === "string"
            ? invoke<WorkspaceMeta>("link_workspace", { folder: picked }) : undefined))
          .then((meta) => { if (meta) useSessionStore.getState().openWorkspace(meta); })
          .catch(() => {});
        return;
      }
      const id = MENU_TO_COMMAND[action];
      if (id) runCommand(id);
    };
    listen<string>("menu", (e) => dispatch(e.payload)).then((u) => { un = u; });
    return () => un?.();
  }, []);
}
