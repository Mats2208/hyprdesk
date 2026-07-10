import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching, foldGutter, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { MergeView } from "@codemirror/merge";
import { editorTokens } from "./theme/tokens";
import { useThemeStore } from "./theme/theme";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";

// Elige la extensión de lenguaje de CodeMirror según la extensión del archivo.
function langFor(path: string): Extension[] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "js": case "jsx": case "mjs": case "cjs": return [javascript()];
    case "ts": return [javascript({ typescript: true })];
    case "tsx": return [javascript({ typescript: true, jsx: true })];
    case "html": case "htm": return [html()];
    case "css": case "scss": case "less": return [css()];
    case "json": return [json()];
    case "md": case "markdown": return [markdown()];
    case "py": return [python()];
    case "rs": return [rust()];
    default: return [];
  }
}

// Tema que funde CodeMirror con el fondo del tile (--tile-bg) y respeta los tokens de tema/fuente.
function makeBlendTheme(): Extension {
  const t = editorTokens();
  const fs = useThemeStore.getState().editorFontSize;
  const line = t.light ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.03)";
  return EditorView.theme({
    "&": { backgroundColor: "transparent", height: "100%", fontSize: `${fs}px`, color: t.text },
    ".cm-scroller": { fontFamily: t.mono, lineHeight: "1.5" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: t.faint },
    ".cm-activeLineGutter": { backgroundColor: line },
    ".cm-activeLine": { backgroundColor: line },
    ".cm-cursor": { borderLeftColor: t.accent },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: t.selection },
    "&.cm-focused": { outline: "none" },
  }, { dark: !t.light });
}

// Extensiones de tema según el tema actual: oscuro/HC usan oneDark; claro usa el highlight por defecto.
function themeExtensions(): Extension[] {
  return editorTokens().light
    ? [makeBlendTheme(), syntaxHighlighting(defaultHighlightStyle)]
    : [oneDark, makeBlendTheme()];
}

function baseExtensions(path: string): Extension[] {
  return [
    lineNumbers(), foldGutter(), highlightActiveLine(), highlightActiveLineGutter(),
    history(), indentOnInput(), bracketMatching(), highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    ...langFor(path),
  ];
}

type Props = {
  id: string;
  title: string;
  active: boolean;
  canClose: boolean;
  maximized: boolean;
  filePath?: string;                    // modo view/edit
  diff?: { old: string; new: string };  // modo merge (diff)
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMax: (id: string) => void;
};

export function CodeTile({ id, title, active, canClose, maximized, filePath, diff, onFocus, onClose, onToggleMax }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedRef = useRef<string>("");     // baseline en disco (para dirty)
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- montar: MergeView (diff) o EditorView (archivo) ----
  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;
    let disposed = false;
    let merge: MergeView | null = null;
    let themeUnsub: (() => void) | undefined;
    const themeComp = new Compartment();

    if (diff) {
      merge = new MergeView({
        a: { doc: diff.old, extensions: [...baseExtensions(filePath ?? title), ...themeExtensions(), EditorView.editable.of(false)] },
        b: { doc: diff.new, extensions: [...baseExtensions(filePath ?? title), ...themeExtensions(), EditorView.editable.of(false)] },
        parent: host,
      });
      // re-medir al tamaño final (evita el texto encimado al abrir mientras el tile se acomoda).
      const m = merge;
      requestAnimationFrame(() => { m.a.requestMeasure(); m.b.requestMeasure(); });
      return () => { merge?.destroy(); };
    }

    // modo archivo: leer del disco y montar editor
    const save = (view: EditorView) => {
      if (!filePath) return true;
      const content = view.state.doc.toString();
      invoke("write_file", { path: filePath, content })
        .then(() => { savedRef.current = content; setDirty(false); setError(null); })
        .catch((e) => setError(String(e)));
      return true;
    };

    (async () => {
      let doc = "";
      if (filePath) {
        try { doc = await invoke<string>("read_file", { path: filePath }); }
        catch (e) { if (!disposed) setError(String(e)); }
      }
      if (disposed || !bodyRef.current) return;
      savedRef.current = doc;
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc,
          extensions: [
            ...baseExtensions(filePath ?? title),
            themeComp.of(themeExtensions()),
            keymap.of([{ key: "Mod-s", preventDefault: true, run: save }]),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) setDirty(u.state.doc.toString() !== savedRef.current);
            }),
          ],
        }),
      });
      viewRef.current = view;
      if (active) view.focus();
      requestAnimationFrame(() => view.requestMeasure()); // re-medir al tamaño final
      // reaccionar a cambios de tema/fuente sin perder ediciones (reconfigurar el compartment).
      themeUnsub = useThemeStore.subscribe(() => view.dispatch({ effects: themeComp.reconfigure(themeExtensions()) }));
    })();

    return () => { disposed = true; themeUnsub?.(); viewRef.current?.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, diff]);

  useEffect(() => { if (active) viewRef.current?.focus(); }, [active]);

  const saveNow = () => {
    const v = viewRef.current;
    if (!v || !filePath) return;
    const content = v.state.doc.toString();
    invoke("write_file", { path: filePath, content })
      .then(() => { savedRef.current = content; setDirty(false); setError(null); })
      .catch((e) => setError(String(e)));
  };

  const cls = ["tile", "tile--code", active ? "tile--active" : ""].join(" ").trim();
  const dir = filePath ? filePath.replace(/\/[^/]*$/, "") : diff ? "diff" : "";

  return (
    <div className={cls} onMouseDown={() => onFocus(id)}>
      <div className="tile__header" onDoubleClick={() => onToggleMax(id)}>
        <span className="tile__status" />
        <span className="tile__title">{title}{dirty ? " ●" : ""}</span>
        <span className="tile__badge tile__badge--code">{diff ? "DIFF" : "ARCHIVO"}</span>
        <span className="tile__path">{dir}</span>
        {error && <span className="tile__exited">error</span>}
        <span className="tile__controls">
          {filePath && (
            <button className="tctl" title="Guardar (⌘S)" disabled={!dirty} onClick={(e) => { e.stopPropagation(); saveNow(); }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 2.5h5l2 2v5h-9v-7z M4 2.5v2.5h3.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button className="tctl" title={maximized ? "Restaurar" : "Maximizar"} onClick={(e) => { e.stopPropagation(); onToggleMax(id); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" /></svg>
          </button>
          <button className="tctl tctl--close" title="Cerrar" disabled={!canClose} onClick={(e) => { e.stopPropagation(); if (canClose) onClose(id); }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </span>
      </div>
      <div className="tile__body tile__body--code" ref={bodyRef} />
    </div>
  );
}
