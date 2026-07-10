import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

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
  onDetectUrl?: (url: string) => void; // detecta localhost:PORT en la salida → preview
};

export function TerminalTile({
  id, title, active, isRouter, canClose, maximized, argv, cwd, env, injectTask, captureEngine, hasActivity, color, branch, onFocus, onClose, onToggleMax, onMerge, onDetectUrl,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [exited, setExited] = useState(false);
  const onDetectRef = useRef(onDetectUrl);
  onDetectRef.current = onDetectUrl;
  const urlBufRef = useRef("");
  const seenUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: "#0e0e10",
        foreground: "#e4e4e7",
        cursor: isRouter ? "#34d399" : "#a1a1aa",
        cursorAccent: "#0e0e10",
        selectionBackground: "rgba(255,255,255,0.14)",
        black: "#18181b",
        brightBlack: "#52525b",
        green: "#34d399",
        brightGreen: "#6ee7b7",
        blue: "#60a5fa",
        cyan: "#22d3ee",
        yellow: "#fbbf24",
        red: "#f87171",
        magenta: "#c084fc",
        white: "#d4d4d8",
        brightWhite: "#fafafa",
      },
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    let unlisten: (() => void) | undefined;
    (async () => {
      const u1 = await listen<OutputPayload>("pty-output", (e) => {
        if (e.payload.id !== id) return;
        const bytes = b64ToBytes(e.payload.data);
        term.write(bytes);
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
            for (const m of urlBufRef.current.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s"'`)\]<>]*/gi)) {
              const u = m[0].replace(/[.,;:]+$/, "");
              if (u && !seenUrlsRef.current.has(u)) { seenUrlsRef.current.add(u); fn(u); }
            }
          }
        }
      });
      const u2 = await listen<string>("pty-exit", (e) => {
        if (e.payload === id) setExited(true);
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

    // Cmd/Ctrl+V: leemos el portapapeles del SO vía Rust. Si hay IMAGEN, inyectamos su RUTA
    // (los agentes leen rutas de imágenes); si hay texto, lo inyectamos. (El webview no entrega
    // imágenes por el evento paste del DOM, por eso lo hacemos así.)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "v") {
        (async () => {
          try {
            const [imgPath, text] = await invoke<[string | null, string | null]>("paste_clipboard");
            if (imgPath) await invoke("pty_write", { id, data: imgPath + " " });
            else if (text) await invoke("pty_write", { id, data: text });
          } catch { /* ignore */ }
        })();
        return false; // que xterm no procese el paste nativo
      }
      return true;
    });

    return () => {
      ro.disconnect();
      onData.dispose();
      unlisten?.();
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
        ? { borderColor: color, boxShadow: `0 0 0 1px ${color}55, 0 12px 36px rgba(0,0,0,0.55)` }
        : { borderColor: `${color}55` })
    : undefined;

  return (
    <div className={cls} style={accent} onMouseDown={() => onFocus(id)}>
      <div className="tile__header" onDoubleClick={() => onToggleMax(id)}>
        <span className="tile__dots">
          <i style={color && !isRouter ? { background: color } : undefined} /><i /><i />
        </span>
        {isRouter && <span className="tile__badge">PRINCIPAL</span>}
        <span className="tile__title">{title}</span>
        {branch && (
          <span className="tile__branch" title={`rama aislada · ${branch}`}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4 5.5v5M5.5 4h3a2 2 0 012 2v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            {branch.replace(/^hyprdesk\//, "")}
          </span>
        )}
        {exited && <span className="tile__exited">exited</span>}
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
