// Shell del IDE: titlebar + tabs + aviso + (activitybar · panel · main) + statusbar + modales.
// Todas las sesiones se montan (PTYs vivos); solo la actual es visible.
import { TitleBar } from "./TitleBar";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { WorktreeNotice } from "./WorktreeNotice";
import { ActivityBar } from "./ActivityBar";
import { SidePanel } from "./SidePanel";
import { TileGrid } from "./TileGrid";
import { RouterSelector } from "./RouterSelector";
import { StatusBar } from "./StatusBar";
import { Modals } from "./Modals";
import { useSystemStats } from "../hooks/useSystemStats";
import { useGitBranch } from "../hooks/useGitBranch";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function Shell() {
  const { stats, glm } = useSystemStats();
  const branch = useGitBranch();
  const sessions = useSessionStore((s) => s.sessions);
  const currentId = useSessionStore((s) => s.currentId);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);

  return (
    <div className="ide">
      <TitleBar stats={stats} glm={glm} branch={branch} />
      <WorkspaceTabs />
      <WorktreeNotice />

      <div className="ide__body">
        <ActivityBar />
        {sidebarOpen && <SidePanel />}
        <div className="main">
          {sessions.map((s) => (
            <div key={s.meta.id} className="wsview" style={{ display: s.meta.id === currentId ? "flex" : "none" }}>
              {s.needsRouter ? <RouterSelector session={s} /> : <TileGrid session={s} />}
            </div>
          ))}
        </div>
      </div>

      <StatusBar />
      <Modals />
    </div>
  );
}
