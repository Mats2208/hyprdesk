// Capa de datos de los workspaces: el tipo + el CRUD contra el backend. La comparten el home
// (WorkspaceManager) y el panel lateral (WorkspacesPanel), que antes tenían cada uno su propia copia
// de las mismas 5 llamadas. La UI (renombrar inline, confirmar borrado) queda en cada componente:
// lo que se comparte son los DATOS, no el chrome.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type WorkspaceMeta = { id: string; name: string; folder: string; lastOpened: number; managed?: boolean };

// Diálogo del SO → enlaza la carpeta elegida como workspace. null si el usuario canceló.
export async function pickFolderAsWorkspace(): Promise<WorkspaceMeta | null> {
  const picked = await open({ directory: true, multiple: false, title: "Abrir carpeta como workspace" });
  if (!picked || typeof picked !== "string") return null;
  return invoke<WorkspaceMeta>("link_workspace", { folder: picked });
}

export function useWorkspaces() {
  const [list, setList] = useState<WorkspaceMeta[]>([]);

  const reload = useCallback(() => {
    invoke<WorkspaceMeta[]>("list_workspaces")
      .then((l) => setList([...l].sort((a, b) => b.lastOpened - a.lastOpened)))
      .catch(() => setList([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (name: string) => {
    const m = await invoke<WorkspaceMeta>("create_workspace", { name: name.trim() });
    reload();
    return m;
  }, [reload]);

  const link = useCallback(async () => {
    const m = await pickFolderAsWorkspace();
    if (m) reload();
    return m;
  }, [reload]);

  const rename = useCallback(async (id: string, name: string) => {
    if (name.trim()) await invoke("rename_workspace", { id, name: name.trim() }).catch(() => {});
    reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await invoke("delete_workspace", { id }).catch(() => {});
    reload();
  }, [reload]);

  return { list, reload, create, link, rename, remove };
}
