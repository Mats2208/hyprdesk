// Panel "Cambios": si el workspace es un repo git muestra su status (con diff al click);
// si no, muestra la lista de archivos que el watcher vio cambiar (abre el archivo al click).
export type GitEntry = { path: string; status: string };
export type WatchEntry = { path: string; kind: string };
export type WsChanges = { git: GitEntry[]; watched: WatchEntry[] };

// Etiqueta + color por código porcelain de git.
function statusLabel(code: string): { txt: string; cls: string } {
  const c = code.trim();
  if (c === "??" || c.includes("A")) return { txt: "nuevo", cls: "chg--add" };
  if (c.includes("D")) return { txt: "borrado", cls: "chg--del" };
  if (c.includes("R")) return { txt: "movido", cls: "chg--mod" };
  return { txt: "modif.", cls: "chg--mod" };
}

const kindLabel: Record<string, { txt: string; cls: string }> = {
  create: { txt: "nuevo", cls: "chg--add" },
  modify: { txt: "modif.", cls: "chg--mod" },
  remove: { txt: "borrado", cls: "chg--del" },
};

export function ChangesPanel({
  changes, root, onOpenDiff, onOpenFile,
}: {
  changes: WsChanges | undefined;
  root: string | null;
  onOpenDiff: (relPath: string) => void;
  onOpenFile: (absPath: string) => void;
}) {
  const git = changes?.git ?? [];
  const watched = changes?.watched ?? [];
  const useGit = git.length > 0;
  const count = useGit ? git.length : watched.length;
  const rel = (abs: string) => (root && abs.startsWith(root) ? abs.slice(root.length + 1) : abs);

  return (
    <div className="sidebar">
      <div className="sidebar__head">
        <span>Cambios · {count}</span>
        {useGit && <span className="chg__repo">git</span>}
      </div>
      <div className="sidebar__list">
        {count === 0 && <div className="fslist__empty">sin cambios</div>}

        {useGit && git.map((g) => {
          const s = statusLabel(g.status);
          return (
            <button key={g.path} className="chgrow" title={g.path} onClick={() => onOpenDiff(g.path)}>
              <span className={`chgrow__badge ${s.cls}`}>{s.txt}</span>
              <span className="chgrow__name">{g.path.split("/").pop()}</span>
              <span className="chgrow__dir">{g.path.replace(/\/?[^/]*$/, "")}</span>
            </button>
          );
        })}

        {!useGit && watched.map((w) => {
          const k = kindLabel[w.kind] ?? { txt: w.kind, cls: "chg--mod" };
          const r = rel(w.path);
          return (
            <button key={w.path} className="chgrow" title={r} onClick={() => onOpenFile(w.path)}>
              <span className={`chgrow__badge ${k.cls}`}>{k.txt}</span>
              <span className="chgrow__name">{r.split("/").pop()}</span>
              <span className="chgrow__dir">{r.replace(/\/?[^/]*$/, "")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
