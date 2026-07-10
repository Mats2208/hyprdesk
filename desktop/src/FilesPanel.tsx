import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// Mini-explorador de archivos (árbol lazy) del workspace. Click en archivo → onOpenFile(path).
type Entry = { name: string; path: string; is_dir: boolean };

function Node({ entry, depth, onOpenFile }: { entry: Entry; depth: number; onOpenFile: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);

  const toggle = async () => {
    if (!entry.is_dir) { onOpenFile(entry.path); return; }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      try { setChildren(await invoke<Entry[]>("list_dir", { path: entry.path })); }
      catch { setChildren([]); }
    }
  };

  return (
    <>
      <button className="fsrow" style={{ paddingLeft: 8 + depth * 12 }} onClick={toggle} title={entry.name}>
        {entry.is_dir ? (
          <svg className={`fsrow__chevron ${open ? "fsrow__chevron--open" : ""}`} width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M4.5 3l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <span className="fsrow__dot" />
        )}
        <span className="fsrow__name">{entry.name}</span>
      </button>
      {open && children?.map((c) => <Node key={c.path} entry={c} depth={depth + 1} onOpenFile={onOpenFile} />)}
    </>
  );
}

export function FilesPanel({ root, onOpenFile }: { root: string | null; onOpenFile: (p: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!root) { setEntries([]); return; }
    invoke<Entry[]>("list_dir", { path: root })
      .then((e) => { setEntries(e); setError(null); })
      .catch((e) => setError(String(e)));
  }, [root]);
  useEffect(() => { reload(); }, [reload]);

  const rootName = root ? root.split("/").pop() || root : "";

  return (
    <div className="sidebar">
      <div className="sidebar__head">
        <span>Archivos · {rootName}</span>
        <button className="sidebar__reload" title="Recargar" onClick={reload}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 11-1.5-3.5M13 2v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div className="sidebar__list fslist">
        {error && <div className="fslist__error">{error}</div>}
        {entries.map((e) => <Node key={e.path} entry={e} depth={0} onOpenFile={onOpenFile} />)}
        {!error && entries.length === 0 && <div className="fslist__empty">carpeta vacía</div>}
      </div>
    </div>
  );
}
