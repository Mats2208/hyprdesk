import type { Profile } from "./App";

// Panel lateral de agentes: roster (router + workers vivos) + perfiles del workspace.
export type AgentRow = { id: string; title: string; role: "router" | "worker"; engine?: string; color?: string };

export const ENGINE_COLOR: Record<string, string> = {
  claude: "#d9a06b",
  codex: "#8b9cff",
  opencode: "#34d399",
};

export function Sidebar({
  agents, activeId, activity, profiles, onFocus, onNewTerminal, onLaunchProfile, onCreateAgent, onDeleteProfile,
}: {
  agents: AgentRow[];
  activeId: string;
  activity: string[];
  profiles: Profile[];
  onFocus: (id: string) => void;
  onNewTerminal: () => void;
  onLaunchProfile: (p: Profile) => void;
  onCreateAgent: () => void;
  onDeleteProfile: (id: string) => void;
}) {
  return (
    <div className="sidebar">
      <div className="sidebar__head">Agentes · {agents.length}</div>
      <div className="sidebar__list">
        {agents.length === 0 && <div className="fslist__empty">sin agentes activos</div>}
        {agents.map((a) => (
          <button
            key={a.id}
            className={`agentrow ${activeId === a.id ? "agentrow--active" : ""} ${activity.includes(a.id) ? "agentrow--pulse" : ""}`}
            onClick={() => onFocus(a.id)}
          >
            <span className="agentrow__dot" style={{ background: a.color || ENGINE_COLOR[a.engine || "claude"] || "#8a8a92" }} />
            <span className="agentrow__name">{a.title}</span>
            {a.role === "router" ? (
              <span className="agentrow__tag agentrow__tag--router">router</span>
            ) : (
              <span className="agentrow__tag">{a.engine || "worker"}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar__head sidebar__head--sub">Perfiles · {profiles.length}</div>
      <div className="sidebar__profiles">
        {profiles.length === 0 && <div className="fslist__empty">sin perfiles · creá uno ↓</div>}
        {profiles.map((p) => (
          <div key={p.id} className="profrow">
            <button className="profrow__open" onClick={() => onLaunchProfile(p)} title={`Lanzar ${p.name}`}>
              <span className="profrow__dot" style={{ background: p.color }} />
              <span className="profrow__name">{p.name}</span>
              <span className="profrow__meta">{p.engine}{p.model ? ` · ${p.model}` : ""}{p.effort ? ` · ${p.effort}` : ""}</span>
            </button>
            <button className="profrow__del" title="Eliminar perfil" onClick={() => onDeleteProfile(p.id)}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          </div>
        ))}
      </div>

      <button className="sidebar__new sidebar__new--agent" onClick={onCreateAgent}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        Crear agente
      </button>
      <button className="sidebar__new" onClick={onNewTerminal}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M5 7l1.5 1.5L5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Terminal
      </button>
    </div>
  );
}
