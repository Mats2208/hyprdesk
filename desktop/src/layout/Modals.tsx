// Todos los overlays/modales, cableados a los stores. Se montan al final del shell.
import { invoke } from "@tauri-apps/api/core";
import { CommandPalette } from "../CommandPalette";
import { SettingsView } from "../settings/SettingsView";
import { CreateAgentModal } from "../CreateAgentModal";
import { AskUserModal } from "../AskUserModal";
import { TeamModal } from "../TeamModal";
import { AgentDetail } from "../AgentDetail";
import { Welcome } from "../onboarding/Welcome";
import { identityOf } from "../store/sessionModel";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function Modals() {
  const toast = useUiStore((s) => s.toast);
  const setToast = useUiStore((s) => s.setToast);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const createAgentOpen = useUiStore((s) => s.createAgentOpen);
  const setCreateAgentOpen = useUiStore((s) => s.setCreateAgentOpen);
  const teamOpen = useUiStore((s) => s.teamOpen);
  const setTeamOpen = useUiStore((s) => s.setTeamOpen);
  const askUser = useUiStore((s) => s.askUser);
  const setAskUser = useUiStore((s) => s.setAskUser);
  const agentDetail = useUiStore((s) => s.agentDetail);
  const setAgentDetail = useUiStore((s) => s.setAgentDetail);
  const welcomeOpen = useUiStore((s) => s.welcomeOpen);

  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const statusByTile = useUiStore((s) => s.statusByTile);
  const { saveProfile, saveAgentAsProfile, launchProfile, launchTeam } = useSessionStore.getState();
  const canLaunch = !!current?.routerId;

  // El detalle sirve a las dos estructuras (agente vivo y perfil) porque ahora comparten la misma
  // identidad. Antes solo el perfil la tenía, y aun así no había forma de verla.
  const detail = (() => {
    if (!agentDetail || !current) return null;
    if (agentDetail.kind === "agent") {
      const t = current.terms.find((x) => x.id === agentDetail.id);
      if (!t) return null;
      return {
        title: t.title, engine: t.engine, color: t.color, branch: t.branch,
        dead: statusByTile[t.id] === "exited",
        identity: identityOf(t),
      };
    }
    const p = current.profiles.find((x) => x.id === agentDetail.id);
    if (!p) return null;
    return { title: p.name, engine: p.engine, color: p.color, branch: undefined, dead: false, identity: identityOf(p) };
  })();

  return (
    <>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
      {createAgentOpen && (
        <CreateAgentModal
          canLaunch={canLaunch}
          onClose={() => setCreateAgentOpen(false)}
          onSave={(p) => saveProfile(p)}
          onSaveAndLaunch={(p) => { saveProfile(p); launchProfile(p); }}
        />
      )}
      {askUser && (
        <AskUserModal
          question={askUser.question}
          onAnswer={(answer) => {
            invoke("answer_user", { questionId: askUser.id, answer }).catch(() => {});
            setAskUser(null);
          }}
        />
      )}
      {teamOpen && (
        <TeamModal
          profiles={current?.profiles ?? []}
          canLaunch={canLaunch}
          onClose={() => setTeamOpen(false)}
          onLaunch={launchTeam}
        />
      )}
      {detail && (
        <AgentDetail
          title={detail.title}
          engine={detail.engine}
          color={detail.color}
          branch={detail.branch}
          identity={detail.identity}
          dead={detail.dead}
          // Solo se promueve un agente vivo que TODAVÍA no salió de un perfil (o sea: uno que diseñó
          // el router). Un perfil ya es un perfil, y un worker lanzado desde uno ya está vinculado.
          onSaveAsProfile={
            agentDetail?.kind === "agent" && !detail.identity.profileId
              ? () => {
                  saveAgentAsProfile(agentDetail.id);
                  setToast(`✅ "${detail.identity.name || detail.title}" guardado como perfil`);
                  setAgentDetail(null);
                }
              : undefined
          }
          onClose={() => setAgentDetail(null)}
        />
      )}
      {welcomeOpen && <Welcome />}
    </>
  );
}
