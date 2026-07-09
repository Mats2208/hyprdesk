import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type WorkspaceMeta = { id: string; name: string; folder: string; lastOpened: number };

function ago(ms: number): string {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "hace instantes";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export function WorkspaceManager({ onOpen }: { onOpen: (m: WorkspaceMeta) => void }) {
  const [list, setList] = useState<WorkspaceMeta[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<WorkspaceMeta[]>("list_workspaces")
      .then((l) => setList([...l].sort((a, b) => b.lastOpened - a.lastOpened)))
      .catch(() => setList([]));
  }, []);

  const create = async () => {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    try {
      const meta = await invoke<WorkspaceMeta>("create_workspace", { name: n });
      onOpen(meta);
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  };

  return (
    <div className="shell">
      <div className="wm">
        <div className="wm__card">
          <div className="wm__brand">🧭 HyprDesk</div>
          <div className="wm__title">Workspaces</div>
          <div className="wm__sub">Cada workspace es su propia carpeta con su router y sus workers.</div>

          <div className="wm__new">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              placeholder="Nombre del nuevo workspace…"
              disabled={creating}
            />
            <button className="wm__create" onClick={create} disabled={creating || !name.trim()}>
              {creating ? "…" : "Crear"}
            </button>
          </div>

          {list.length > 0 && (
            <div className="wm__list">
              {list.map((w) => (
                <button key={w.id} className="wm__item" onClick={() => onOpen(w)}>
                  <span className="wm__item-name">{w.name}</span>
                  <span className="wm__item-meta">{ago(w.lastOpened)}</span>
                </button>
              ))}
            </div>
          )}
          {list.length === 0 && <div className="wm__empty">Todavía no tenés workspaces. Creá el primero ↑</div>}
          {error && <div className="wm__error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
