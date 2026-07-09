import { useEffect, useMemo, useState } from "react";

export type Command = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const filtered = useMemo(
    () => commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    [commands, q]
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
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); run(filtered[idx]); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
        />
        <div className="palette__list">
          {filtered.length === 0 && <div className="palette__empty">Sin resultados</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`palette__item ${i === idx ? "palette__item--active" : ""}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              {c.hint && <span className="palette__hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
