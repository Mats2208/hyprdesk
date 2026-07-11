// Panel de Archivos: árbol del workspace (list_dir, hijos on-demand). Click en archivo → openFile.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type DirEntry = { name: string; path: string; is_dir: boolean };

const folderIcon = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 013.5 3h2.6l1.4 1.4h5A1.5 1.5 0 0114 5.9v5.6A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
);
const fileIcon = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 2.5h5l3 3v8H4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M9 2.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
);

function TreeNode({ entry, depth, onOpenFile }: { entry: DirEntry; depth: number; onOpenFile: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  const toggle = async () => {
    if (!entry.is_dir) { onOpenFile(entry.path); return; }
    if (!open && children === null) {
      try { setChildren(await invoke<DirEntry[]>("list_dir", { path: entry.path })); }
      catch { setChildren([]); }
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button className="filerow" style={{ paddingLeft: 8 + depth * 12 }} onClick={toggle} title={entry.name}>
        {entry.is_dir
          ? <svg className={`filerow__caret ${open ? "filerow__caret--open" : ""}`} width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          : <span className="filerow__caret" />}
        <span className="filerow__icon">{entry.is_dir ? folderIcon : fileIcon}</span>
        <span className="filerow__name">{entry.name}</span>
      </button>
      {entry.is_dir && open && children && children.map((c) => (
        <TreeNode key={c.path} entry={c} depth={depth + 1} onOpenFile={onOpenFile} />
      ))}
    </>
  );
}

export function FilesPanel({ folder, onOpenFile }: { folder: string | null; onOpenFile: (p: string) => void }) {
  const [roots, setRoots] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (!folder) { setRoots(null); return; }
    let cancelled = false;
    invoke<DirEntry[]>("list_dir", { path: folder })
      .then((r) => { if (!cancelled) setRoots(r); })
      .catch(() => { if (!cancelled) setRoots([]); });
    return () => { cancelled = true; };
  }, [folder]);

  return (
    <div className="sidebar">
      <div className="sidebar__head">Archivos</div>
      <div className="sidebar__list filetree">
        {!folder && <div className="fslist__empty">sin workspace abierto</div>}
        {folder && roots && roots.length === 0 && <div className="fslist__empty">carpeta vacía</div>}
        {roots && roots.map((e) => <TreeNode key={e.path} entry={e} depth={0} onOpenFile={onOpenFile} />)}
      </div>
    </div>
  );
}
