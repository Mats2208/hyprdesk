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
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMax: (id: string) => void;
};

export function TerminalTile({
  id, title, active, isRouter, canClose, maximized, argv, cwd, env, injectTask, captureEngine, hasActivity, onFocus, onClose, onToggleMax,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [exited, setExited] = useState(false);

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
        if (e.payload.id === id) term.write(b64ToBytes(e.payload.data));
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

  return (
    <div className={cls} onMouseDown={() => onFocus(id)}>
      <div className="tile__header" onDoubleClick={() => onToggleMax(id)}>
        <span className="tile__dots">
          <i /><i /><i />
        </span>
        {isRouter && <span className="tile__badge">PRINCIPAL</span>}
        <span className="tile__title">{title}</span>
        <span className="tile__path">~/PROYECTOS/a2a</span>
        {exited && <span className="tile__exited">exited</span>}
        <span className="tile__controls">
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
