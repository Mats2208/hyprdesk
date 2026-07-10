// Raíz de composición: monta los hooks globales y elige la pantalla (gestor de workspaces vs IDE).
// El estado y la lógica viven en los stores (store/) y el layout en (layout/).
import { WorkspaceManager } from "./WorkspaceManager";
import { SettingsModal } from "./SettingsModal";
import { Shell } from "./layout/Shell";
import { useBackendEvents } from "./hooks/useBackendEvents";
import { useNativeMenu } from "./hooks/useNativeMenu";
import { useKeyboard } from "./hooks/useKeyboard";
import { useAppEffects } from "./hooks/useAppEffects";
import { useSessionStore } from "./store/sessionStore";
import { useUiStore } from "./store/uiStore";

function App() {
  useBackendEvents();
  useNativeMenu();
  useKeyboard();
  useAppEffects();

  const stage = useSessionStore((s) => s.stage);
  const openWorkspace = useSessionStore((s) => s.openWorkspace);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  if (stage === "workspaces") {
    return (
      <>
        <WorkspaceManager onOpen={openWorkspace} />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </>
    );
  }
  return <Shell />;
}

export default App;
