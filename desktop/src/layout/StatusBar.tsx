// Barra de estado: workers/ws · cambios · ramas · previews de localhost · atajos.
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";
import { hk } from "../platform";

export function StatusBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const previewsByWs = useSessionStore((s) => s.previewsByWs);
  const openBrowser = useSessionStore((s) => s.openBrowser);
  const openPanel = useUiStore((s) => s.openPanel);

  const workers = current ? current.terms.filter((t) => t.role === "worker") : [];
  const curPreviews = current ? previewsByWs[current.meta.folder] ?? [] : [];
  const branchCount = current ? current.terms.filter((t) => t.branch).length : 0;

  return (
    <div className="statusbar">
      <div className="statusbar__group">
        <span className="sb-chip sb-chip--role" title="workers activos · workspaces abiertos">
          <span className="dot dot--router" />
          {workers.length}<span className="sb-chip__u">w</span> · {sessions.length}<span className="sb-chip__u">ws</span>
        </span>
        {branchCount > 0 && (
          <button className="sb-chip sb-chip--purple" title="workers en ramas aisladas (worktrees)" onClick={() => openPanel("agents")}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4 5.5v5M5.5 4h3a2 2 0 012 2v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            {branchCount}
          </button>
        )}
      </div>

      <div className="statusbar__group statusbar__group--center">
        {curPreviews.slice(0, 4).map((u) => {
          let port = ""; try { const url = new URL(u); port = url.port || url.host; } catch { port = u; }
          return (
            <button key={u} className="sb-chip sb-chip--preview" title={`Abrir preview: ${u}`} onClick={() => openBrowser(u)}>
              <span className="sb-chip__dot" /> :{port}
            </button>
          );
        })}
      </div>

      <div className="statusbar__group statusbar__group--right">
        <span className="sb-keys" title={`${hk("K")} comandos · ${hk("B")} panel · ${hk("T")} terminal · ${hk("←")}${hk("→")} foco`}>
          <kbd>{hk("K")}</kbd><kbd>{hk("B")}</kbd><kbd>{hk("T")}</kbd>
        </span>
      </div>
    </div>
  );
}
