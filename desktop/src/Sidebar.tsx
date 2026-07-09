// Panel lateral de agentes (roster tipo VS Code): router + workers, con foco y estado.
export type AgentRow = { id: string; title: string; role: "router" | "worker"; engine?: string };

const ENGINE_COLOR: Record<string, string> = {
  claude: "#d9a06b",
  codex: "#8b9cff",
  opencode: "#34d399",
};

export function Sidebar({
  agents, activeId, activity, onFocus, onNewTerminal,
}: {
  agents: AgentRow[];
  activeId: string;
  activity: string[];
  onFocus: (id: string) => void;
  onNewTerminal: () => void;
}) {
  return (
    <div className="sidebar">
      <div className="sidebar__head">Agentes</div>
      <div className="sidebar__list">
        {agents.map((a) => (
          <button
            key={a.id}
            className={`agentrow ${activeId === a.id ? "agentrow--active" : ""} ${activity.includes(a.id) ? "agentrow--pulse" : ""}`}
            onClick={() => onFocus(a.id)}
          >
            <span className="agentrow__dot" style={{ background: ENGINE_COLOR[a.engine || "claude"] || "#8a8a92" }} />
            <span className="agentrow__name">{a.title}</span>
            {a.role === "router" ? (
              <span className="agentrow__tag agentrow__tag--router">router</span>
            ) : (
              <span className="agentrow__tag">{a.engine || "worker"}</span>
            )}
          </button>
        ))}
      </div>
      <button className="sidebar__new" onClick={onNewTerminal}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        Terminal
      </button>
    </div>
  );
}
