// Panel Source Control (RightDock): rama + ahead/behind, commit, push/pull, ramas (checkout/merge),
// y la lista de cambios (click → diff). Estilo VS Code, monocromo.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

type Sync = { branch: string | null; ahead: number; behind: number; upstream: boolean };

// Etiqueta corta por código porcelain de git.
function statusLabel(code: string): { txt: string; cls: string } {
  const c = code.trim();
  if (c === "??" || c.includes("A")) return { txt: "nuevo", cls: "chg--add" };
  if (c.includes("D")) return { txt: "borrado", cls: "chg--del" };
  if (c.includes("R")) return { txt: "movido", cls: "chg--mod" };
  return { txt: "modif.", cls: "chg--mod" };
}

const BranchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.3" /><path d="M4 5.6v4.8M5.6 4h3.2a2 2 0 012 2v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
);

export function SourceControl() {
  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const changesByWs = useSessionStore((s) => s.changesByWs);
  const { openDiff, startWatching } = useSessionStore.getState();
  const setToast = useUiStore((s) => s.setToast);
  const folder = current?.meta.folder ?? null;
  const git = (folder ? changesByWs[folder]?.git : undefined) ?? [];

  const [msg, setMsg] = useState("");
  const [sync, setSync] = useState<Sync>({ branch: null, ahead: 0, behind: 0, upstream: false });
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showBranches, setShowBranches] = useState(false);

  const refresh = () => {
    if (!folder) return;
    invoke<Sync>("git_sync_state", { cwd: folder }).then(setSync).catch(() => {});
    invoke<string[]>("git_branches", { cwd: folder }).then(setBranches).catch(() => {});
    startWatching(folder);
  };
  useEffect(refresh, [folder, changesByWs]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
    if (!folder) return false;
    setBusy(true);
    try {
      const r = await fn();
      const last = String(r ?? "").trim().split("\n").filter(Boolean).slice(-1)[0] || "ok";
      setToast(`${label}: ${last}`);
      return true;
    } catch (e) {
      setToast(`${label} falló: ${String(e).trim().split("\n").filter(Boolean).slice(-1)[0]}`);
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const commit = async () => {
    if (!folder || !msg.trim()) return;
    if (await run("Commit", () => invoke("git_commit", { cwd: folder, message: msg.trim() }))) setMsg("");
  };
  const push = () => folder && run("Push", () => invoke("git_push", { cwd: folder }));
  const pull = () => folder && run("Pull", () => invoke("git_pull", { cwd: folder }));
  const checkout = (b: string) => run(`Checkout ${b}`, () => invoke("git_checkout", { cwd: folder!, branch: b }));
  const merge = (b: string) => run(`Merge ${b}`, () => invoke("git_merge_branch", { cwd: folder!, branch: b }));

  return (
    <div className="scm">
      <div className="sidebar__head">
        <span>Source Control</span>
        <button className="scm__ibtn" title="Refrescar" onClick={refresh}>↻</button>
      </div>

      {folder && (
        <>
          <div className="scm__branchbar">
            <button className="scm__branch" onClick={() => setShowBranches((v) => !v)} title="Cambiar / mergear rama" disabled={!sync.branch}>
              <BranchIcon /> {sync.branch ?? "sin repo"}
            </button>
            <button className="scm__sync" disabled={busy || !sync.upstream} onClick={pull} title="Pull">↓ {sync.behind || ""}</button>
            <button className="scm__sync" disabled={busy || !sync.upstream} onClick={push} title="Push">↑ {sync.ahead || ""}</button>
          </div>

          {showBranches && (
            <div className="scm__branches">
              {branches.length === 0 && <div className="fslist__empty">sin ramas</div>}
              {branches.map((b) => (
                <div key={b} className="scm__brow">
                  <button className={`scm__bname ${b === sync.branch ? "scm__bname--on" : ""}`} disabled={busy} onClick={() => checkout(b)} title={`Checkout ${b}`}>{b}</button>
                  {b !== sync.branch && <button className="scm__bmerge" disabled={busy} onClick={() => merge(b)} title={`Merge ${b} → ${sync.branch}`}>merge</button>}
                </div>
              ))}
            </div>
          )}

          <div className="scm__commit">
            <textarea
              className="scm__msg" rows={2} placeholder="Mensaje de commit… (⌘↵)" value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } }}
            />
            <button className="scm__commitbtn" disabled={busy || !msg.trim()} onClick={commit}>
              Commit{git.length ? ` · ${git.length}` : ""}
            </button>
          </div>

          <div className="sidebar__head sidebar__head--sub">Cambios · {git.length}</div>
          <div className="scm__list">
            {git.length === 0 && <div className="fslist__empty">sin cambios</div>}
            {git.map((g) => {
              const s = statusLabel(g.status);
              return (
                <button key={g.path} className="chgrow" title={g.path} onClick={() => openDiff(g.path)}>
                  <span className={`chgrow__badge ${s.cls}`}>{s.txt}</span>
                  <span className="chgrow__name">{g.path.split("/").pop()}</span>
                  <span className="chgrow__dir">{g.path.replace(/\/?[^/]*$/, "")}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
