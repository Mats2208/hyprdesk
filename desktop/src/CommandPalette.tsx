import { useEffect, useMemo, useState } from "react";
import fuzzysort from "fuzzysort";
import { listCommands, type Command } from "./commands/registry";
import { comboLabel, getBindings } from "./commands/keybindings";

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const binds = getBindings();
  const hint = (c: Command) => (binds[c.id] ? comboLabel(binds[c.id]) : c.keybinding);
  const all = useMemo(() => listCommands().filter((c) => !c.when || c.when()), []);
  const results = useMemo<Command[]>(
    () => (q ? fuzzysort.go(q, all, { key: "title" }).map((r) => r.obj) : all),
    [all, q]
  );

  useEffect(() => { setIdx(0); }, [q]);

  const run = (c?: Command) => { if (c) { c.run(); onClose(); } };

  return (
    <div className="palette__overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette__input"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Escribí un comando…"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); run(results[idx]); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
        />
        <div className="palette__list">
          {results.length === 0 && <div className="palette__empty">Sin resultados</div>}
          {results.map((c, i) => {
            // en modo lista (sin query) mostramos subtítulos de categoría al cambiar de grupo
            const header = !q && (i === 0 || results[i - 1].category !== c.category) ? c.category : null;
            return (
              <div key={c.id}>
                {header && <div className="palette__cat">{header}</div>}
                <button
                  className={`palette__item ${i === idx ? "palette__item--active" : ""}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => run(c)}
                >
                  <span>{c.title}</span>
                  {hint(c) && <span className="palette__hint">{hint(c)}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
