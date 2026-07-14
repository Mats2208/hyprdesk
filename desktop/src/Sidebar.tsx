import type { Profile, TileStatus } from "./types";
import { EngineIcon } from "./EngineIcon";

// Panel lateral de agentes: roster (router + workers vivos) + perfiles del workspace.
type AgentRow = { id: string; title: string; role: "router" | "worker"; engine?: string; color?: string; status?: TileStatus; branch?: string };

// Un agente que diseñó el ROUTER y que todavía no es un perfil tuyo. Vive abajo, con los perfiles —
// que es donde se inspecciona el DISEÑO de un agente— y no arriba en el roster, que muestra QUIÉN
// está vivo y ya va bastante cargado.
type RouterAgentRow = { id: string; name: string; engine?: string; color?: string; model?: string; effort?: string };

const ENGINE_COLOR: Record<string, string> = {
  claude: "#d9a06b",
  codex: "#8b9cff",
  opencode: "#34d399",
};

export function Sidebar({
  agents, activeId, activity, profiles, routerAgents, onFocus, onNewTerminal, onLaunchProfile, onCreateAgent, onLaunchTeam, onDeleteProfile, onShowAgent, onShowProfile,
}: {
  agents: AgentRow[];
  activeId: string;
  activity: string[];
  profiles: Profile[];
  routerAgents: RouterAgentRow[];
  onFocus: (id: string) => void;
  onNewTerminal: () => void;
  onLaunchProfile: (p: Profile) => void;
  onCreateAgent: () => void;
  onLaunchTeam: () => void;
  onDeleteProfile: (id: string) => void;
  onShowAgent: (id: string) => void;
  onShowProfile: (id: string) => void;
}) {
  return (
    <div className="sidebar">
      <div className="sidebar__head">Equipo · {agents.length}</div>
      <div className="sidebar__list">
        {agents.length === 0 && <div className="fslist__empty">sin agentes activos</div>}
        {[...agents].sort((a, b) => (a.role === "router" ? -1 : b.role === "router" ? 1 : 0)).map((a) => (
          <button
            key={a.id}
            className={`agentrow ${a.role === "worker" ? "agentrow--worker" : ""} ${activeId === a.id ? "agentrow--active" : ""} ${activity.includes(a.id) ? "agentrow--pulse" : ""}`}
            onClick={() => onFocus(a.id)}
            title={a.branch ? `rama ${a.branch}` : undefined}
          >
            <span
              className={`agentrow__status agentrow__status--${a.status || "idle"}`}
              title={a.status === "working" ? "trabajando" : a.status === "exited" ? "terminó / cerrado" : "en espera"}
            />
            <span className="agentrow__dot" style={{ background: a.color || ENGINE_COLOR[a.engine || "claude"] || "#8a8a92" }} />
            <span className="agentrow__name">{a.title}</span>
            {a.branch && <span className="agentrow__branch" title={a.branch}>⑂</span>}
            {a.engine && <EngineIcon engine={a.engine} size={16} className="agentrow__eng" />}
            {a.role === "router" ? (
              <span className="agentrow__tag agentrow__tag--router">router</span>
            ) : !a.engine ? (
              <span className="agentrow__tag">worker</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="sidebar__head sidebar__head--sub">
        <span>Perfiles · {profiles.length}</span>
        {profiles.length > 0 && (
          <button className="sidebar__team" onClick={onLaunchTeam} title="Lanzar un equipo de perfiles a la vez">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 2.5l8 4.5-8 4.5z" fill="currentColor" /></svg>
            equipo
          </button>
        )}
      </div>
      <div className="sidebar__profiles">
        {profiles.length === 0 && routerAgents.length === 0 && <div className="fslist__empty">sin perfiles · creá uno ↓</div>}
        {profiles.map((p) => (
          <div key={p.id} className="profrow">
            <button className="profrow__open" onClick={() => onShowProfile(p.id)} title={`Ver la personalidad y las skills de ${p.name}`}>
              <span className="profrow__dot" style={{ background: p.color }} />
              <span className="profrow__name">{p.name}</span>
              <span className="profrow__meta">
                <EngineIcon engine={p.engine} size={13} />
                {[p.model, p.effort].filter(Boolean).join(" · ")}
              </span>
            </button>
            <button className="profrow__go" title={`Lanzar ${p.name}`} onClick={() => onLaunchProfile(p)}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 2l7 4-7 4z" fill="currentColor" /></svg>
            </button>
            <button className="profrow__del" title="Eliminar perfil" onClick={() => onDeleteProfile(p.id)}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          </div>
        ))}

        {/* Los que diseñó el ROUTER. Separados a propósito: todavía no son perfiles tuyos — son
            instancias vivas. Abrilos, leelos, y si te gustan, guardalos como perfil. */}
        {routerAgents.length > 0 && (
          <>
            <div className="profgroup">del router · {routerAgents.length}</div>
            {routerAgents.map((a) => (
              <div key={a.id} className="profrow profrow--router">
                <button className="profrow__open" onClick={() => onShowAgent(a.id)} title="Lo diseñó el router · ver su personalidad y guardarlo como perfil">
                  <span className="profrow__dot" style={{ background: a.color || ENGINE_COLOR[a.engine || "claude"] || "#8a8a92" }} />
                  <span className="profrow__name">{a.name}</span>
                  <span className="profrow__meta">
                    <EngineIcon engine={a.engine} size={13} />
                    {[a.model, a.effort].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </div>
            ))}
          </>
        )}
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
