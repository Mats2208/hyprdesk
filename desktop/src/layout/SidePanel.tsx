// Panel lateral: conmuta entre Workspaces / Agentes (Sidebar) / Archivos según uiStore.panel.
import { Sidebar } from "../Sidebar";
import { WorkspacesPanel } from "../WorkspacesPanel";
import { FilesPanel } from "./FilesPanel";
import { WebPanel } from "./WebPanel";
import { hasIdentity } from "../store/sessionModel";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function SidePanel() {
  const panel = useUiStore((s) => s.panel);
  const activity = useUiStore((s) => s.activity);
  const statusByTile = useUiStore((s) => s.statusByTile);
  const setCreateAgentOpen = useUiStore((s) => s.setCreateAgentOpen);
  const setTeamOpen = useUiStore((s) => s.setTeamOpen);
  const setAgentDetail = useUiStore((s) => s.setAgentDetail);

  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const { openWorkspace, setActive, addTerminal, launchProfile, deleteProfile } = useSessionStore.getState();

  if (panel === "workspaces") {
    return <WorkspacesPanel activeId={current?.meta.id ?? undefined} onSwitch={openWorkspace} />;
  }

  if (panel === "files") {
    return <FilesPanel folder={current?.meta.folder ?? null} onOpenFile={useSessionStore.getState().openFile} />;
  }

  if (panel === "web") {
    return <WebPanel />;
  }

  const tiles = current?.terms.filter((t) => !t.kind || t.kind === "terminal") ?? [];
  const agents = tiles.map((t) => ({
    id: t.id, title: t.title, role: t.role, engine: t.engine, color: t.color, status: statusByTile[t.id], branch: t.branch,
  }));
  // Workers con identidad propia que NO salieron de un perfil tuyo → los diseñó el router. Se listan
  // abajo, junto a los perfiles, porque ahí es donde se mira el diseño de un agente (y desde ahí se
  // guardan como perfil). Una vez guardados tienen profileId y dejan de aparecer acá.
  const routerAgents = tiles
    .filter((t) => t.role === "worker" && !t.profileId && hasIdentity(t))
    .map((t) => ({ id: t.id, name: t.name || t.title, engine: t.engine, color: t.color, model: t.model, effort: t.effort }));

  return (
    <Sidebar
      agents={agents}
      activeId={current?.activeId ?? ""}
      activity={activity}
      profiles={current?.profiles ?? []}
      routerAgents={routerAgents}
      onFocus={setActive}
      onNewTerminal={addTerminal}
      onLaunchProfile={(p) => launchProfile(p)}
      onCreateAgent={() => setCreateAgentOpen(true)}
      onLaunchTeam={() => setTeamOpen(true)}
      onDeleteProfile={deleteProfile}
      onShowAgent={(id) => setAgentDetail({ kind: "agent", id })}
      onShowProfile={(id) => setAgentDetail({ kind: "profile", id })}
    />
  );
}
