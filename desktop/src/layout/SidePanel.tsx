// Panel lateral: conmuta entre Workspaces / Agentes (Sidebar) / Archivos / Cambios según uiStore.panel.
import { Sidebar } from "../Sidebar";
import { WorkspacesPanel } from "../WorkspacesPanel";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function SidePanel() {
  const panel = useUiStore((s) => s.panel);
  const activity = useUiStore((s) => s.activity);
  const statusByTile = useUiStore((s) => s.statusByTile);
  const setCreateAgentOpen = useUiStore((s) => s.setCreateAgentOpen);
  const setTeamOpen = useUiStore((s) => s.setTeamOpen);

  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const { openWorkspace, setActive, addTerminal, launchProfile, deleteProfile } = useSessionStore.getState();

  if (panel === "workspaces") {
    return <WorkspacesPanel activeId={current?.meta.id ?? undefined} onSwitch={openWorkspace} />;
  }

  const agents = current
    ? current.terms.filter((t) => !t.kind || t.kind === "terminal").map((t) => ({
        id: t.id, title: t.title, role: t.role, engine: t.engine, color: t.color, status: statusByTile[t.id], branch: t.branch,
      }))
    : [];
  return (
    <Sidebar
      agents={agents}
      activeId={current?.activeId ?? ""}
      activity={activity}
      profiles={current?.profiles ?? []}
      onFocus={setActive}
      onNewTerminal={addTerminal}
      onLaunchProfile={(p) => launchProfile(p)}
      onCreateAgent={() => setCreateAgentOpen(true)}
      onLaunchTeam={() => setTeamOpen(true)}
      onDeleteProfile={deleteProfile}
    />
  );
}
