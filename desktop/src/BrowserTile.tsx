import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

// Tile navegador: iframe + barra de URL + navegación. CSP=null ⇒ localhost/file no se bloquean.
// (back/forward/reload sólo funcionan bien same-origin; si el sitio prohíbe iframes, "abrir externo".)
type Props = {
  id: string;
  title: string;
  active: boolean;
  canClose: boolean;
  maximized: boolean;
  url?: string;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMax: (id: string) => void;
};

// Normaliza lo tipeado a una URL cargable (agrega http:// si falta esquema).
function normalize(u: string): string {
  const s = u.trim();
  if (!s) return "";
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith("file:") || s.startsWith("about:")) return s;
  return "http://" + s;
}

export function BrowserTile({ id, title, active, canClose, maximized, url, onFocus, onClose, onToggleMax }: Props) {
  const [addr, setAddr] = useState(url ?? "");
  const [src, setSrc] = useState(normalize(url ?? ""));
  const [nonce, setNonce] = useState(0);        // fuerza remount del iframe (reload)
  const [doc, setDoc] = useState<string | null>(null); // srcDoc para file:// (WKWebView bloquea iframes file://)
  const frameRef = useRef<HTMLIFrameElement>(null);

  // file:// → leemos el HTML y lo inyectamos por srcDoc (funciona con HTML self-contained).
  useEffect(() => {
    if (src.startsWith("file://")) {
      const p = decodeURIComponent(src.replace(/^file:\/\//, ""));
      invoke<string>("read_file", { path: p })
        .then(setDoc)
        .catch(() => setDoc("<p style='font:14px system-ui;padding:20px;color:#666'>No se pudo leer el archivo.</p>"));
    } else {
      setDoc(null);
    }
  }, [src, nonce]);

  const go = () => { const u = normalize(addr); setSrc(u); setAddr(u); setNonce((n) => n + 1); };
  const reload = () => setNonce((n) => n + 1);
  const back = () => { try { frameRef.current?.contentWindow?.history.back(); } catch { /* cross-origin */ } };
  const fwd = () => { try { frameRef.current?.contentWindow?.history.forward(); } catch { /* cross-origin */ } };
  const ext = () => { if (src) openUrl(src).catch(() => {}); };

  const cls = ["tile", "tile--browser", active ? "tile--active" : ""].join(" ").trim();

  return (
    <div className={cls} onMouseDown={() => onFocus(id)}>
      <div className="tile__header" onDoubleClick={() => onToggleMax(id)}>
        <span className="tile__dots"><i /><i /><i /></span>
        <span className="tile__badge tile__badge--browser">WEB</span>
        <span className="tile__title">{title}</span>
        <span className="tile__controls">
          <button className="tctl" title={maximized ? "Restaurar" : "Maximizar"} onClick={(e) => { e.stopPropagation(); onToggleMax(id); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" /></svg>
          </button>
          <button className="tctl tctl--close" title="Cerrar" disabled={!canClose} onClick={(e) => { e.stopPropagation(); if (canClose) onClose(id); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </span>
      </div>
      <div className="tile__body tile__body--browser">
        <div className="browsertile__bar" onMouseDown={(e) => e.stopPropagation()}>
          <button className="browsertile__nav" title="Atrás" onClick={back}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <button className="browsertile__nav" title="Adelante" onClick={fwd}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5.5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <button className="browsertile__nav" title="Recargar" onClick={reload}><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 11-1.5-3.5M13 2v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <input
            className="browsertile__url" value={addr} placeholder="localhost:3000 · file://…"
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          />
          <button className="browsertile__nav" title="Abrir en el navegador del sistema" onClick={ext}><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 3H3.5v9.5H13V10M9.5 3H13v3.5M13 3l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
        {!src
          ? <div className="browsertile__empty">Escribí una URL arriba (o dejá que se autodetecte un <code>localhost</code>).</div>
          : doc !== null
            ? <iframe key={"doc" + nonce} ref={frameRef} className="browsertile__frame" srcDoc={doc} title={title} />
            : <iframe key={src + nonce} ref={frameRef} className="browsertile__frame" src={src} title={title} />}
      </div>
    </div>
  );
}
