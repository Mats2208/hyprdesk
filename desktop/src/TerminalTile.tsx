import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { monoFont, xtermTheme } from "./theme/tokens";
import { useThemeStore } from "./theme/theme";
import { encodeKey, installKittyKeyboard } from "./terminal/keys";
import { isMac } from "./platform";

// base64 (bytes crudos del PTY) -> Uint8Array para xterm.write sin corromper UTF-8.
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type OutputPayload = { id: string; data: string };

type Props = {
  id: string;
  title: string;
  active: boolean;
  isRouter: boolean;
  canClose: boolean;
  maximized: boolean;
  argv?: string[]; // si viene, el PTY corre este comando en vez del shell
  cwd?: string; // directorio de trabajo del PTY
  env?: [string, string][]; // env extra del motor (ej. OPENCODE_CONFIG)
  injectTask?: string; // tarea a inyectar tras arrancar (opencode)
  captureEngine?: string; // motor cuyo session-id hay que capturar (codex/opencode)
  hasActivity?: boolean; // recibió un mensaje del túnel y no está enfocado (parpadeo)
  color?: string; // color propio del agente (de un perfil)
  branch?: string; // rama del worktree (repos git)
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMax: (id: string) => void;
  onMerge?: (id: string) => void; // mergear la rama del worker a la principal
  onRestart?: (id: string) => void; // revivir el agente muerto (--resume de su sesión)
  onDetectUrl?: (url: string) => void; // detecta localhost:PORT en la salida → preview
  onOpenLink?: (url: string) => void; // click en una URL de la salida → navegador embebido
  onStatus?: (id: string, status: "working" | "idle" | "exited") => void; // estado del agente
};

export function TerminalTile({
  id, title, active, isRouter, canClose, maximized, argv, cwd, env, injectTask, captureEngine, hasActivity, color, branch, onFocus, onClose, onToggleMax, onMerge, onDetectUrl, onOpenLink, onStatus,
  onRestart,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [exited, setExited] = useState(false);
  const [live, setLive] = useState<"working" | "idle">("idle"); // pulso del header: ¿está produciendo salida?
  const onDetectRef = useRef(onDetectUrl);
  onDetectRef.current = onDetectUrl;
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const busyRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const urlBufRef = useRef("");
  const seenUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: monoFont(),
      fontSize: useThemeStore.getState().termFontSize,
      lineHeight: 1.35,
      cursorBlink: true,
      allowProposedApi: true,
      theme: xtermTheme(isRouter),
      // Hyperlinks OSC 8: los CLIs (Claude Code, etc.) emiten URLs "clickeables por diseño" como
      // secuencia de escape, con el texto y el destino separados. A diferencia del WebLinksAddon
      // (regex sobre lo pintado), esto sobrevive a que el TUI parta el URL en dos renglones cuando
      // el tile es angosto: el destino viaja aparte, no se lee del buffer. Abre en el navegador embebido.
      linkHandler: {
        activate: (_e, uri) => onOpenLinkRef.current?.(uri),
        allowNonHttpProtocols: false,
      },
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    // URLs de la salida → clickeables, abren en el navegador embebido.
    term.loadAddon(new WebLinksAddon((_e, uri) => onOpenLinkRef.current?.(uri)));
    term.open(host);

    // Renderer por GPU. Con varios agentes streaming a la vez el renderer DOM satura el main thread
    // (era EL cuello de botella); WebGL lo saca de encima. Si el contexto se pierde, xterm vuelve solo
    // al DOM: por eso disponemos el addon en vez de reventar.
    //
    // ATADO A LA VISIBILIDAD: los tiles de un workspace inactivo siguen montados (la vista se oculta
    // con display:none, ver Shell.tsx), y antes cada uno pedía su contexto igual. 3 workspaces × 9
    // tiles = 27 contextos; Chromium corta en ~16 y fuerza la pérdida del más viejo → las terminales
    // perdían la GPU en silencio, justo lo que WebGL venía a dar. Un tile oculto no necesita ninguno:
    // se engancha al mostrarse y se suelta al ocultarse. IntersectionObserver ve el display:none.
    let webgl: WebglAddon | undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (webgl) return;
        try {
          const addon = new WebglAddon();
          addon.onContextLoss(() => { addon.dispose(); if (webgl === addon) webgl = undefined; });
          term.loadAddon(addon);
          webgl = addon;
        } catch { /* sin WebGL (VM, drivers viejos) → renderer DOM, funciona igual */ }
      } else {
        webgl?.dispose();
        webgl = undefined;
      }
    });
    io.observe(host);
    fit.fit();

    // Protocolo de teclado de Kitty: lo negocian codex/opencode y así Shift+Enter llega distinguible.
    const kitty = installKittyKeyboard(term, (data) => { invoke("pty_write", { id, data }); });
    const isAgent = !!argv?.length; // en un shell pelado no tocamos las teclas

    // Reaccionar a cambios de tema/fuente: re-aplicar tema, tamaño y familia, y re-ajustar.
    const themeUnsub = useThemeStore.subscribe(() => {
      term.options.theme = xtermTheme(isRouter);
      term.options.fontFamily = monoFont();
      term.options.fontSize = useThemeStore.getState().termFontSize;
      try { fit.fit(); } catch { /* host aún no medible */ }
    });

    let unlisten: (() => void) | undefined;
    (async () => {
      const u1 = await listen<OutputPayload>("pty-output", (e) => {
        if (e.payload.id !== id) return;
        const bytes = b64ToBytes(e.payload.data);
        term.write(bytes);
        // estado: hay salida → "trabajando"; tras 1.5s sin salida → "idle". Alimenta el pulso del
        // header (live) y el statusByTile global (onStatus) a la vez.
        if (!busyRef.current) { busyRef.current = true; setLive("working"); onStatusRef.current?.(id, "working"); }
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => { busyRef.current = false; setLive("idle"); onStatusRef.current?.(id, "idle"); }, 1500);
        // autodetección de dev servers: buscar localhost:PUERTO en la salida (una vez por URL).
        // Importante: hay que SACAR los escapes ANSI del terminal antes de matchear, si no se
        // cuelan en la URL (colores/cursor codes pegados al texto → chips con basura).
        const fn = onDetectRef.current;
        if (fn) {
          const raw = new TextDecoder().decode(bytes);
          // GUARD barato: la gran mayoría de los chunks no tienen URL → evitamos el regex pesado
          // (crítico para no colgar el main thread con varios agentes streaming a la vez).
          if (raw.includes("://") || raw.includes("localhost")) {
            const text = raw
              .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC
              .replace(/\x1b[@-Z\\-_]/g, "")                     // esc de un char
              .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")         // CSI (colores, mover cursor)
              .replace(/[\x00-\x1f\x7f]/g, " ");                 // otros control chars → espacio
            urlBufRef.current = (urlBufRef.current + text).slice(-4000);
            // el path DEBE empezar con "/" → así "…:5173en" no se come el "en" (bug de chips rotos).
            for (const m of urlBufRef.current.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s"'`)\]<>]*)?/gi)) {
              let u: string;
              try { u = new URL(m[0]).origin; } catch { continue; } // normalizar a origin (dedup + chip limpio)
              if (!seenUrlsRef.current.has(u)) { seenUrlsRef.current.add(u); fn(u); }
            }
          }
        }
      });
      const u2 = await listen<string>("pty-exit", (e) => {
        if (e.payload === id) { setExited(true); setLive("idle"); busyRef.current = false; clearTimeout(idleTimerRef.current); onStatusRef.current?.(id, "exited"); }
      });
      unlisten = () => { u1(); u2(); };
      await invoke("pty_spawn", {
        id, cols: term.cols, rows: term.rows, cwd: cwd ?? null, program: null, argv: argv ?? null,
        env: env ?? null, injectTask: injectTask ?? null, captureEngine: captureEngine ?? null,
      });
      term.focus();
    })();

    const onData = term.onData((data) => { invoke("pty_write", { id, data }); });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* aún sin layout */ }
      invoke("pty_resize", { id, cols: term.cols, rows: term.rows });
    });
    ro.observe(host);

    // Pegar: leemos el portapapeles del SO vía Rust. Si hay IMAGEN, inyectamos su RUTA (los agentes
    // leen rutas de imágenes); si hay texto, lo pegamos con term.paste(). (El webview no entrega
    // imágenes por el evento paste del DOM, por eso lo hacemos por Rust/arboard.)
    //
    // term.paste() y NO pty_write directo: xterm envuelve el texto en bracketed paste (ESC[200~ …
    // ESC[201~) cuando el agente lo pide, y así los \n de un texto multilínea llegan como TEXTO. Un
    // pty_write crudo los manda como Enter → el agente enviaba el mensaje a medio escribir.
    const doPaste = async () => {
      try {
        const [imgPath, text] = await invoke<[string | null, string | null]>("paste_clipboard");
        // Entrecomillar SOLO si la ruta trae espacios (ej. %TEMP% bajo "C:\Users\John Doe\..."): sin
        // comillas el agente leería solo el primer trozo. El caso común (sin espacios) queda idéntico.
        if (imgPath) {
          const arg = imgPath.includes(" ") ? `"${imgPath}"` : imgPath;
          await invoke("pty_write", { id, data: arg + " " });
        }
        else if (text) term.paste(text);
      } catch { /* ignore */ }
    };
    // Copiar: xterm no copia solo. Copiamos la selección vía Rust/arboard.
    const doCopy = () => {
      const sel = term.getSelection();
      if (sel) invoke("copy_clipboard", { text: sel }).catch(() => {});
      term.clearSelection();
    };

    // Teclado: Ctrl/Cmd+V (y Ctrl+Shift+V) pegan. Copiar = Ctrl+Shift+C, o Ctrl/Cmd+C SOLO si hay
    // selección (si no, dejamos pasar el Ctrl+C para que sea SIGINT/interrupt, como toda terminal).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;

      // Shift/Alt/Ctrl + Enter → salto de línea, NO enviar. xterm mandaría "\r" pelado (= enviar).
      //
      // preventDefault() es IMPRESCINDIBLE, no cosmético: xterm captura el teclado con un <textarea>
      // oculto, y el navegador SÍ tiene acción por defecto para Shift+Enter en un textarea (meter un
      // salto de línea). Ese newline se colaba por el input del textarea y el agente lo leía como
      // Enter → enviaba el mensaje. Ctrl+Enter funcionaba justamente porque no tiene default.
      if (isAgent) {
        const seq = encodeKey(e, kitty);
        if (seq) {
          e.preventDefault();
          invoke("pty_write", { id, data: seq });
          return false;
        }
      }

      if (!(e.metaKey || e.ctrlKey)) return true;
      const k = e.key.toLowerCase();
      // preventDefault() otra vez IMPRESCINDIBLE: devolver false solo le dice a xterm que no encodee
      // la tecla, pero NO cancela el evento del DOM. Sin esto, el webview pegaba ADEMÁS por su cuenta
      // en el textarea oculto → dos escrituras al PTY (el texto salía duplicado).
      if (k === "v") { e.preventDefault(); doPaste(); return false; }
      if (k === "c") {
        const wantsCopy = e.shiftKey || (isMac ? e.metaKey : e.ctrlKey);
        if (wantsCopy && term.hasSelection()) { doCopy(); return false; }
        return true; // sin selección → Ctrl+C pasa como interrupt
      }
      return true;
    });

    // Click derecho (estilo Windows Terminal): si hay selección la copia; si no, pega.
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) doCopy();
      else doPaste();
    };
    host.addEventListener("contextmenu", onCtx);

    return () => {
      ro.disconnect();
      io.disconnect(); // term.dispose() suelta el addon; el observer hay que desconectarlo a mano
      themeUnsub();
      onData.dispose();
      unlisten?.();
      host.removeEventListener("contextmenu", onCtx);
      clearTimeout(idleTimerRef.current);
      invoke("pty_kill", { id });
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (active) termRef.current?.focus(); }, [active]);

  const cls = [
    "tile",
    active ? "tile--active" : "",
    isRouter ? "tile--router" : "",
    exited ? "tile--exited" : "",
    hasActivity && !active ? "tile--activity" : "",
  ].join(" ").trim();

  const accent = color && !isRouter
    ? (active
        ? { borderColor: color, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px ${color}55, 0 12px 36px rgba(0,0,0,0.55)` }
        : { borderColor: `${color}55` })
    : undefined;

  return (
    <div className={cls} style={accent} onMouseDown={() => onFocus(id)}>
      <div className="tile__header" onDoubleClick={() => onToggleMax(id)}>
        <span
          className={`tile__status ${exited ? "tile__status--exited" : isRouter ? "tile__status--router" : ""} ${!exited && live === "working" ? "tile__status--working" : ""}`}
          style={color && !isRouter && !exited ? { background: color } : undefined}
        />
        <span className="tile__title">{title}</span>
        {isRouter && <span className="tile__badge">ROUTER</span>}
        {branch && (
          <span className="tile__branch" title={`rama aislada · ${branch}`}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4 5.5v5M5.5 4h3a2 2 0 012 2v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            {branch.replace(/^hyprdesk\//, "")}
          </span>
        )}
        {exited && <span className="tile__exited">exited</span>}
        {exited && onRestart && (
          <button className="tile__revive" title="Relanza el agente con --resume: retoma la sesión donde quedó"
            onClick={(e) => { e.stopPropagation(); onRestart(id); }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path d="M13 8a5 5 0 11-1.6-3.7M13 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            revivir
          </button>
        )}
        <span className="tile__controls">
          {branch && onMerge && (
            <button className="tctl tctl--merge" title={`Merge ${branch} → rama principal`} onClick={(e) => { e.stopPropagation(); onMerge(id); }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.3" /><path d="M4 5.6v.4a4 4 0 004 4h2.4M4 10.4V5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          )}
          <button
            className="tctl"
            title={maximized ? "Restaurar" : "Maximizar"}
            onClick={(e) => { e.stopPropagation(); onToggleMax(id); }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="1.5" y="1.5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button
            className="tctl tctl--close"
            title={isRouter ? "El router no se puede cerrar" : "Cerrar"}
            disabled={isRouter || !canClose}
            onClick={(e) => { e.stopPropagation(); if (!isRouter && canClose) onClose(id); }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      </div>
      <div className="tile__body" ref={bodyRef} />
    </div>
  );
}
