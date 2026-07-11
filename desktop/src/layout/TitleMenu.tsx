// Barra de menú custom (Windows/Linux frameless) — Archivo/Editar/Ver/Ventana como dropdowns,
// estilo VS Code. En macOS no se usa (menú global nativo). Los botones hacen preventDefault en
// mousedown para NO robar el foco del input activo → las acciones de Editar (execCommand) actúan
// sobre él. Un menú abierto se cambia al pasar el mouse por otro título (como VS Code).
import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hk } from "../platform";
import { runMenuAction } from "../commands/menuActions";

type Item = "sep" | { label: string; hint?: string; run: () => void };

export function TitleMenu() {
  const win = useMemo(() => getCurrentWindow(), []);
  const [open, setOpen] = useState<string | null>(null);
  const exec = (cmd: string) => () => { document.execCommand(cmd); };
  const paste = () => { navigator.clipboard.readText().then((t) => document.execCommand("insertText", false, t)).catch(() => {}); };

  const menus: { label: string; items: Item[] }[] = [
    { label: "Archivo", items: [
      { label: "Nuevo workspace", hint: hk("N"), run: () => runMenuAction("new-workspace") },
      { label: "Abrir carpeta…", hint: hk("O"), run: () => runMenuAction("open-folder") },
      "sep",
      { label: "Nueva ventana", run: () => runMenuAction("new-window") },
      { label: "Cerrar workspace", run: () => runMenuAction("close-workspace") },
    ] },
    { label: "Editar", items: [
      { label: "Deshacer", hint: hk("Z"), run: exec("undo") },
      { label: "Rehacer", hint: hk("Y"), run: exec("redo") },
      "sep",
      { label: "Cortar", hint: hk("X"), run: exec("cut") },
      { label: "Copiar", hint: hk("C"), run: exec("copy") },
      { label: "Pegar", hint: hk("V"), run: paste },
      "sep",
      { label: "Seleccionar todo", hint: hk("A"), run: exec("selectAll") },
    ] },
    { label: "Ver", items: [
      { label: "Mostrar / ocultar panel", hint: hk("B"), run: () => runMenuAction("toggle-sidebar") },
      { label: "Comandos…", hint: hk("K"), run: () => runMenuAction("palette") },
      "sep",
      { label: "Pantalla completa", run: () => { win.isFullscreen().then((f) => win.setFullscreen(!f)).catch(() => {}); } },
    ] },
    { label: "Ventana", items: [
      { label: "Minimizar", run: () => { void win.minimize(); } },
      { label: "Nueva ventana", run: () => runMenuAction("new-window") },
      "sep",
      { label: "Cerrar ventana", run: () => { void win.close(); } },
    ] },
  ];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".tmenu")) setOpen(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="tmenu">
      {menus.map((m) => (
        <div className="tmenu__group" key={m.label}>
          <button
            className={`tmenu__title ${open === m.label ? "tmenu__title--on" : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen(open === m.label ? null : m.label)}
            onMouseEnter={() => { if (open) setOpen(m.label); }}
          >{m.label}</button>
          {open === m.label && (
            <div className="tmenu__drop">
              {m.items.map((it, i) => it === "sep"
                ? <div key={i} className="tmenu__sep" />
                : (
                  <button
                    key={i} className="tmenu__item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { it.run(); setOpen(null); }}
                  >
                    <span>{it.label}</span>
                    {it.hint && <span className="tmenu__hint">{it.hint}</span>}
                  </button>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
