import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

// Tile navegador. localhost/file → <iframe>/srcDoc (andan bien). Sitios EXTERNOS (que bloquean el
// iframe con X-Frame-Options) → webview NATIVA de Tauri superpuesta al tile, posicionada al rect del
// body por un loop de rAF (y ocultada cuando el tile no está visible o hay un modal encima).
type Props = {
  id: string;
  title: string;
  active: boolean;
  canClose: boolean;
  maximized: boolean;
  url?: string;
  hidden?: boolean; // forzar ocultar la webview nativa (modal abierto, etc.)
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMax: (id: string) => void;
};

// Normaliza lo tipeado a una URL cargable (agrega http:// si falta esquema).
export function normalize(u: string): string {
  const s = u.trim();
  if (!s) return "";
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith("file:") || s.startsWith("about:")) return s;
  return "http://" + s;
}

// ¿URL externa? (http/https y host que NO es localhost) → necesita webview nativa.
function isExternalUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === "http:" || url.protocol === "https:") && !["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function BrowserTile({ id, title, active, canClose, maximized, url, hidden, onFocus, onClose, onToggleMax }: Props) {
  const [addr, setAddr] = useState(url ?? "");
  const [src, setSrc] = useState(normalize(url ?? ""));
  const [nonce, setNonce] = useState(0);        // fuerza remount del iframe (reload)
  const [doc, setDoc] = useState<string | null>(null); // srcDoc para file:// (WKWebView bloquea iframes file://)
  const frameRef = useRef<HTMLIFrameElement>(null);
  const nativeRef = useRef<HTMLDivElement>(null); // placeholder donde flota la webview nativa
  const external = isExternalUrl(src);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

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

  // Webview NATIVA para sitios externos: la creamos y la mantenemos pegada al rect del placeholder.
  //
  // El rAF corre SOLO mientras la ventana está visible. Antes latía a 60fps para siempre —incluso
  // con la app minimizada— nada más que para comparar un rect que no se movía. Cuando la ventana se
  // oculta, el loop se corta entero (no es que "no hace nada": no existe).
  useEffect(() => {
    if (!external) return;
    const label = `browser-${id}`;
    let raf = 0;
    let corriendo = false;
    let opened = false;
    let last = "";

    const tick = () => {
      const r = nativeRef.current?.getBoundingClientRect();
      if (r) {
        const visible = !hiddenRef.current && r.width > 20 && r.height > 20 && r.bottom > 0 && r.right > 0 && document.visibilityState === "visible";
        const b = visible
          ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
          : { x: -20000, y: 0, w: 800, h: 600 }; // fuera de pantalla = "oculto"
        const key = `${b.x},${b.y},${b.w},${b.h}`;
        if (key !== last) {
          last = key;
          if (!opened) { opened = true; invoke("browser_open", { label, url: src, ...b }).catch(() => {}); }
          else invoke("browser_bounds", { label, ...b }).catch(() => {});
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const arrancar = () => { if (!corriendo) { corriendo = true; raf = requestAnimationFrame(tick); } };
    const parar = () => { corriendo = false; cancelAnimationFrame(raf); };
    const onVis = () => (document.visibilityState === "visible" ? arrancar() : parar());

    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", onVis);
      invoke("browser_close", { label }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, src, external, nonce]);

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
          : external
            ? <div className="browsertile__native" ref={nativeRef}><span className="browsertile__nativehint">webview nativa</span></div>
            : doc !== null
              ? <iframe key={"doc" + nonce} ref={frameRef} className="browsertile__frame" srcDoc={doc} title={title} />
              : <iframe key={src + nonce} ref={frameRef} className="browsertile__frame" src={src} title={title} />}
      </div>
    </div>
  );
}
