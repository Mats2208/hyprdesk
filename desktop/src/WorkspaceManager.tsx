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
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  const remove = async (id: string) => {
    setConfirmId(null);
    try { await invoke("delete_workspace", { id }); } catch (e) { setError(String(e)); }
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
                  {confirmId === w.id ? (
                    <span className="wm__item-actions wm__item-actions--show">
                      <span className="wm__confirm-txt">¿Borrar?</span>
                      <button className="wm__act wm__act--del" title="Confirmar"
                        onClick={(e) => { e.stopPropagation(); remove(w.id); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                      <button className="wm__act" title="Cancelar"
                        onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                      </button>
                    </span>
                  ) : (
                    <span className="wm__item-actions">
                      <button className="wm__act" title="Renombrar"
                        onClick={(e) => { e.stopPropagation(); setEditingId(w.id); setEditName(w.name); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                      </button>
                      <button className="wm__act wm__act--del" title="Eliminar"
                        onClick={(e) => { e.stopPropagation(); setConfirmId(w.id); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </span>
                  )}
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
