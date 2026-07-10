// Aviso one-time: aislamiento por worktrees activado (cuando hay workers en ramas).
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function WorktreeNotice() {
  const branchCount = useSessionStore((s) => {
    const cur = s.sessions.find((x) => x.meta.id === s.currentId);
    return cur ? cur.terms.filter((t) => t.branch).length : 0;
  });
  const dismissed = useUiStore((s) => s.wtNoticeDismissed);
  const dismiss = useUiStore((s) => s.dismissWtNotice);

  if (branchCount === 0 || dismissed) return null;
  return (
    <div className="wtnotice">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.3" /><path d="M4 5.6v4.8M5.6 4h3.2a2 2 0 012 2v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
      <span><b>Aislamiento por worktrees activado.</b> Cada worker trabaja en su propia rama <code>hyprdesk/…</code> para no pisarse. Sus cambios NO están en la rama principal hasta que el router (o vos, con el botón ⑂ del tile) los mergea. Mergeá antes de cerrar un worker o se descarta su trabajo.</span>
      <button onClick={dismiss} title="Entendido">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
