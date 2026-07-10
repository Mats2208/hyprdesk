// RightDock = Source Control (git): ramas, cambios con diff, y commit/push/pull/merge.
import { SourceControl } from "./SourceControl";

export function RightDock() {
  return (
    <div className="rightdock">
      <SourceControl />
    </div>
  );
}
