// Tile editor de archivos (tipo VSC). CodeMirror 6, LAZY-MOUNTED: el EditorView solo existe
// mientras el tile está visible (no montamos CM en tiles ocultos → evita el lag de antes). El
// buffer y el estado "sin guardar" persisten en refs, así ocultar/mostrar no pierde ediciones.
// Cargar: read_file · Guardar (⌘/Ctrl+S): write_file.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { css as cssLang } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import type { Extension } from "@codemirror/state";
import { useUiStore } from "./store/uiStore";

type Props = {
  id: string;
  title: string;
  filePath: string;
  active: boolean;
  canClose: boolean;
  maximized: boolean;
  hidden?: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMax: (id: string) => void;
};

// Lenguaje CodeMirror por extensión (solo los lang-* instalados; resto sin resaltado).
function langFor(path: string): Extension {
  const ext = (path.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "js": case "jsx": case "cjs": case "mjs": return javascript({ jsx: true });
    case "ts": return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "css": return cssLang();
    case "html": case "htm": return html();
    case "json": return json();
    case "md": case "markdown": return markdown();
    case "py": return python();
    case "rs": return rust();
    default: return [];
  }
}

export function FileTile({ id, title, filePath, active, canClose, maximized, hidden, onFocus, onClose, onToggleMax }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const docRef = useRef<string>("");   // buffer actual (fuente de verdad cuando CM no está montado)
  const savedRef = useRef<string>(""); // último contenido guardado en disco
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const setToast = useUiStore((s) => s.setToast);

  // Guardar a disco (⌘S o botón). Lee el buffer actual desde el ref.
  const doSave = useCallback(async () => {
    if (!filePath) return;
    const content = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
    try {
      await invoke("write_file", { path: filePath, content });
      docRef.current = content;
      savedRef.current = content;
      setDirty(false);
      setToast(`Guardado ${title}`);
    } catch (e) {
      setToast(`No se pudo guardar: ${String(e)}`);
    }
  }, [filePath, title, setToast]);

  // Cargar el archivo cuando cambia la ruta.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    invoke<string>("read_file", { path: filePath })
      .then((c) => { if (cancelled) return; docRef.current = c; savedRef.current = c; setDirty(false); setLoaded(true); })
      .catch((e) => { if (cancelled) return; setError(String(e)); });
    return () => { cancelled = true; };
  }, [filePath]);

  // Montar CodeMirror SOLO cuando el tile está visible; destruirlo (preservando el buffer) al ocultar.
  useEffect(() => {
    if (hidden || !loaded || error || !hostRef.current) return;
    const view = new EditorView({
      doc: docRef.current,
      parent: hostRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => { void doSave(); return true; } },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        oneDark,
        langFor(filePath),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            docRef.current = u.state.doc.toString();
            setDirty(docRef.current !== savedRef.current);
          }
        }),
      ],
    });
    viewRef.current = view;
    view.focus();
    return () => {
      docRef.current = view.state.doc.toString(); // preservar ediciones al desmontar/ocultar
      view.destroy();
      viewRef.current = null;
    };
  }, [hidden, loaded, error, filePath, doSave]);

  const cls = ["tile", "tile--code", "tile--file", active ? "tile--active" : ""].join(" ").trim();

  return (
    <div className={cls} onMouseDown={() => onFocus(id)}>
      <div className="tile__header" onDoubleClick={() => onToggleMax(id)}>
        <span className="tile__dots"><i /><i /><i /></span>
        <span className="tile__badge tile__badge--file">FILE</span>
        <span className="tile__title">{title}{dirty && <span className="tile__dirty" title="Sin guardar"> ●</span>}</span>
        <span className="tile__controls">
          <button className="tctl" title="Guardar (⌘S)" onClick={(e) => { e.stopPropagation(); void doSave(); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2h6l2 2v6H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M4 2v3h3M4 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
          </button>
          <button className="tctl" title={maximized ? "Restaurar" : "Maximizar"} onClick={(e) => { e.stopPropagation(); onToggleMax(id); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" /></svg>
          </button>
          <button className="tctl tctl--close" title="Cerrar" disabled={!canClose} onClick={(e) => { e.stopPropagation(); if (canClose) onClose(id); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </span>
      </div>
      <div className="tile__body tile__body--file">
        {error
          ? <div className="filetile__err">No se pudo abrir el archivo (¿binario o no-UTF8?).<br />{error}</div>
          : <div className="filetile__cm" ref={hostRef} />}
      </div>
    </div>
  );
}
