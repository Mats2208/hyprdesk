import { useState } from "react";
import { BrandMark } from "./BrandMark";
import { WindowControls } from "./layout/WindowControls";
import { isMac } from "./platform";
import { type WorkspaceMeta, useWorkspaces } from "./store/workspaces";
import ambientSvg from "./assets/brand/ambient.svg?raw";

function ago(ms: number): string {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "hace instantes";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export function WorkspaceManager({ onOpen }: { onOpen: (m: WorkspaceMeta) => void }) {
  const { list, create, link, rename, remove } = useWorkspaces();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const doCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try { onOpen(await create(name)); } catch (e) { setError(String(e)); setCreating(false); }
  };

  // Abre una carpeta EXTERNA existente (proyecto real) como workspace enlazado.
  const openFolder = async () => {
    try {
      const meta = await link();
      if (meta) onOpen(meta);
    } catch (e) { setError(String(e)); }
  };

  const saveRename = async (id: string) => {
    setEditingId(null);
    await rename(id, editName);
  };

  const doRemove = async (id: string) => {
    setConfirmId(null);
    await remove(id);
  };

  return (
    <div className="welcome">
      <div className="welcome__ambient" aria-hidden dangerouslySetInnerHTML={{ __html: ambientSvg }} />
      {/* Windows/Linux frameless: el home no tiene titlebar → franja de arrastre + controles flotantes. */}
      {!isMac && <div className="home-caption" />}
      {!isMac && <div className="home-wctl"><WindowControls /></div>}
      <div className="welcome__inner">
        <header className="welcome__hero">
          <div className="welcome__logo">
            <BrandMark size={30} />
          </div>
          <div>
            <h1 className="welcome__name">HyprDesk</h1>
            <p className="welcome__tag">Orquestá un equipo de agentes de IA de código, en tu escritorio.</p>
          </div>
        </header>

        <div className="welcome__cols">
          <section className="welcome__col">
            <h2 className="welcome__h">Empezar</h2>
            <div className="welcome__new">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doCreate(); }}
                placeholder="Nombre del nuevo workspace…"
                disabled={creating}
              />
              <button className="welcome__create" onClick={doCreate} disabled={creating || !name.trim()}>
                {creating ? "…" : "Crear"}
              </button>
            </div>
            <button className="welcome__action" onClick={openFolder}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 5.5A1.5 1.5 0 013.5 4H6l1.5 1.5H12.5A1.5 1.5 0 0114 7v4.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
              <span>Abrir una carpeta existente…</span>
            </button>
            <p className="welcome__note">Cada workspace es su propia carpeta con su router y sus workers.</p>
            {error && <div className="welcome__error">{error}</div>}
          </section>

          <section className="welcome__col">
            <h2 className="welcome__h">Reciente</h2>
            {list.length === 0 && <div className="welcome__empty">Todavía no tenés workspaces. Creá o abrí uno a la izquierda.</div>}
            <div className="welcome__list">
              {list.map((w) => (
                <div key={w.id} className="welcome__item">
                  {editingId === w.id ? (
                    <input
                      className="welcome__rename"
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
                    <button className="welcome__item-open" onClick={() => onOpen(w)} title={w.folder}>
                      <span className="welcome__item-icon">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 5.5A1.5 1.5 0 013.5 4H6l1.5 1.5H12.5A1.5 1.5 0 0114 7v4.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
                      </span>
                      <span className="welcome__item-name">{w.name}</span>
                      {w.managed === false && <span className="welcome__ext" title={w.folder}>externo</span>}
                      <span className="welcome__item-meta">{ago(w.lastOpened)}</span>
                    </button>
                  )}
                  {confirmId === w.id ? (
                    <span className="welcome__item-actions welcome__item-actions--show">
                      <span className="welcome__confirm-txt">¿Borrar?</span>
                      <button className="welcome__act welcome__act--del" title="Confirmar"
                        onClick={(e) => { e.stopPropagation(); doRemove(w.id); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                      <button className="welcome__act" title="Cancelar"
                        onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                      </button>
                    </span>
                  ) : (
                    <span className="welcome__item-actions">
                      <button className="welcome__act" title="Renombrar"
                        onClick={(e) => { e.stopPropagation(); setEditingId(w.id); setEditName(w.name); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                      </button>
                      <button className="welcome__act welcome__act--del" title="Eliminar"
                        onClick={(e) => { e.stopPropagation(); setConfirmId(w.id); }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
