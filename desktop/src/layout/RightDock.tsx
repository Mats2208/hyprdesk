// RightDock = Source Control (git). Por ahora muestra los cambios; las acciones git
// (commit/push/pull/merge/diff) se agregan en la sub-etapa de Source Control.
import { ChangesPanel } from "../ChangesPanel";
import { useSessionStore } from "../store/sessionStore";

export function RightDock() {
  const current = useSessionStore((s) => s.sessions.find((x) => x.meta.id === s.currentId) ?? null);
  const changesByWs = useSessionStore((s) => s.changesByWs);
  const { openDiff, openFile } = useSessionStore.getState();
  return (
    <div className="rightdock">
      <ChangesPanel
        changes={current ? changesByWs[current.meta.folder] : undefined}
        root={current?.meta.folder ?? null}
        onOpenDiff={openDiff}
        onOpenFile={openFile}
      />
    </div>
  );
}
