// Menú nativo de macOS: el backend emite "menu"<action> → despachamos a los stores.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { WorkspaceMeta } from "../WorkspaceManager";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function useNativeMenu() {
  useEffect(() => {
    let un: (() => void) | undefined;
    const dispatch = (action: string) => {
      const ss = useSessionStore.getState();
      const us = useUiStore.getState();
      switch (action) {
        case "new-workspace": us.openPanel("workspaces"); break;
        case "open-folder":
          open({ directory: true, multiple: false, title: "Abrir carpeta como workspace" })
            .then((picked) => (picked && typeof picked === "string"
              ? invoke<WorkspaceMeta>("link_workspace", { folder: picked }) : undefined))
            .then((meta) => { if (meta) ss.openWorkspace(meta); })
            .catch(() => {});
          break;
        case "close-workspace": if (ss.currentId) ss.closeWorkspace(ss.currentId); break;
        case "toggle-sidebar": us.setSidebarOpen((o) => !o); break;
        case "palette": us.togglePalette(); break;
        case "settings": us.setSettingsOpen(true); break;
      }
    };
    listen<string>("menu", (e) => dispatch(e.payload)).then((u) => { un = u; });
    return () => un?.();
  }, []);
}
