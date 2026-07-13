import { useState } from "react";
import { type WorkspaceMeta, useWorkspaces } from "./store/workspaces";

// Panel de workspaces en la sidebar: lista switcheable + crear/renombrar/eliminar inline.
export function WorkspacesPanel({
  activeId, onSwitch,
}: {
  activeId?: string;
  onSwitch: (m: WorkspaceMeta) => void;
}) {
  const { list, create, link, rename, remove } = useWorkspaces();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const doCreate = async () => {
    if (!newName.trim()) return;
    const n = newName;
    setNewName("");
    try { onSwitch(await create(n)); } catch { /* ignore */ }
  };

  const saveRename = async (id: string) => {
    setEditingId(null);
    await rename(id, editName);
  };

  const del = async (id: string) => {
    setConfirmId(null);
    await remove(id);
  };

  const openFolder = async () => {
    try {
      const m = await link();
      if (m) onSwitch(m);
    } catch { /* ignore */ }
  };

  return (
    <div className="sidebar">
      <div className="sidebar__head">Workspaces · {list.length}</div>
      <div className="sidebar__list">
        {list.map((w) => (
          <div key={w.id} className={`wsrow ${activeId === w.id ? "wsrow--active" : ""}`}>
            {editingId === w.id ? (
              <input
                className="wsrow__rename" autoFocus value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveRename(w.id); if (e.key === "Escape") setEditingId(null); }}
                onBlur={() => saveRename(w.id)}
              />
            ) : (
              <button className="wsrow__open" onClick={() => onSwitch(w)}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 5.5A1.5 1.5 0 013.5 4H6l1.5 1.5H12.5A1.5 1.5 0 0114 7v4.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                <span className="wsrow__name">{w.name}</span>
                {w.managed === false && <span className="wsrow__ext" title={w.folder}>↗</span>}
              </button>
            )}
            {confirmId === w.id ? (
              <span className="wsrow__actions wsrow__actions--show">
                <button className="wm__act wm__act--del" title="Confirmar" onClick={() => del(w.id)}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button className="wm__act" title="Cancelar" onClick={() => setConfirmId(null)}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </span>
            ) : (
              <span className="wsrow__actions">
                <button className="wm__act" title="Renombrar" onClick={(e) => { e.stopPropagation(); setEditingId(w.id); setEditName(w.name); }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
                </button>
                <button className="wm__act wm__act--del" title="Eliminar" onClick={(e) => { e.stopPropagation(); setConfirmId(w.id); }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="sidebar__newws">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") doCreate(); }}
          placeholder="Nuevo workspace…"
        />
        <button onClick={doCreate} disabled={!newName.trim()} title="Crear workspace">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <button onClick={openFolder} title="Abrir carpeta existente…">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 5.5A1.5 1.5 0 013.5 4H6l1.5 1.5H12.5A1.5 1.5 0 0114 7v4.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  );
}
