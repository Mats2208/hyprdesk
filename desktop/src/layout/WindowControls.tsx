// Controles de ventana (min/max/cerrar) para Windows/Linux frameless. En macOS los pone el SO
// (Overlay). Se usa en el titlebar del IDE y flotando en el home (donde no hay titlebar).
import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  const win = useMemo(() => getCurrentWindow(), []);
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    let un: (() => void) | undefined;
    win.isMaximized().then(setMaxed).catch(() => {});
    win.onResized(() => { win.isMaximized().then(setMaxed).catch(() => {}); }).then((f) => { un = f; });
    return () => un?.();
  }, [win]);
  return (
    <div className="wctl">
      <button className="wctl__btn" title="Minimizar" onClick={() => void win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5h6" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button className="wctl__btn" title={maxed ? "Restaurar" : "Maximizar"} onClick={() => void win.toggleMaximize()}>
        {maxed ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="3" width="5" height="5" stroke="currentColor" strokeWidth="1" /><path d="M4 3V1.5h4.5V6H7" stroke="currentColor" strokeWidth="1" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1" /></svg>
        )}
      </button>
      <button className="wctl__btn wctl__btn--close" title="Cerrar" onClick={() => void win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}
