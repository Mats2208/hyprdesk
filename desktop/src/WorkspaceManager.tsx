import { useCallback, useEffect, useState } from "react";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const reload = useCallback(() => {
    invoke<WorkspaceMeta[]>("list_workspaces")
      .then((l) => setList([...l].sort((a, b) => b.lastOpened - a.lastOpened)))
      .catch(() => setList([]));
  }, []);

  useEffect(() => { reload(); }, [reload]);

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

  const saveRename = async (id: string) => {
    const n = editName.trim();
    setEditingId(null);
    if (!n) return;
    try { await invoke("rename_workspace", { id, name: n }); } catch (e) { setError(String(e)); }
    reload();
  };

  const remove = async (w: WorkspaceMeta) => {
    if (!confirm(`¿Eliminar el workspace "${w.name}"? Se borra su carpeta y todo su contenido.`)) return;
    try { await invoke("delete_workspace", { id: w.id }); } catch (e) { setError(String(e)); }
    reload();
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
                <div key={w.id} className="wm__item">
                  {editingId === w.id ? (
                    <input
                      className="wm__rename"
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(w.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => saveRename(w.id)}
                    />
                  ) : (
                    <button className="wm__item-open" onClick={() => onOpen(w)}>
                      <span className="wm__item-name">{w.name}</span>
                      <span className="wm__item-meta">{ago(w.lastOpened)}</span>
                    </button>
                  )}
                  <span className="wm__item-actions">
                    <button className="wm__act" title="Renombrar"
                      onClick={(e) => { e.stopPropagation(); setEditingId(w.id); setEditName(w.name); }}>✎</button>
                    <button className="wm__act wm__act--del" title="Eliminar"
                      onClick={(e) => { e.stopPropagation(); remove(w); }}>🗑</button>
                  </span>
                </div>
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
