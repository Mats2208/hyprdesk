// Rama git del workspace actual (para el titlebar). Se refresca al cambiar de workspace o sus cambios.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";

export function useGitBranch(): string | null {
  const [branch, setBranch] = useState<string | null>(null);
  const currentId = useSessionStore((s) => s.currentId);
  const folder = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId)?.meta.folder);
  const changesByWs = useSessionStore((s) => s.changesByWs);

  useEffect(() => {
    if (!folder) { setBranch(null); return; }
    invoke<string | null>("git_branch", { cwd: folder }).then(setBranch).catch(() => setBranch(null));
  }, [currentId, folder, changesByWs]);

  return branch;
}
