// Todos los overlays/modales, cableados a los stores. Se montan al final del shell.
import { invoke } from "@tauri-apps/api/core";
import { CommandPalette } from "../CommandPalette";
import { SettingsModal } from "../SettingsModal";
import { CreateAgentModal } from "../CreateAgentModal";
import { AskUserModal } from "../AskUserModal";
import { TeamModal } from "../TeamModal";
import { useCommands } from "../commands/useCommands";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function Modals() {
  const commands = useCommands();
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

  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const { saveProfile, launchProfile, launchTeam } = useSessionStore.getState();
  const canLaunch = !!current?.routerId;

  return (
    <>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
    </>
  );
}
