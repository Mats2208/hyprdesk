import { useEffect, useRef, useState } from "react";
import { hk } from "./platform";

// El router llamó a ask_user() y está BLOQUEADO esperando la respuesta del usuario.
// Este modal recoge la respuesta y la manda al backend (answer_user) para destrabarlo.
export function AskUserModal({
  question, onAnswer,
}: {
  question: string;
  onAnswer: (answer: string) => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const send = () => {
    const a = text.trim();
    if (a) onAnswer(a);
  };

  return (
    <div className="modal-overlay">
      <div className="modal askuser">
        <div className="askuser__head">
          <span className="askuser__badge">router</span>
          <span className="askuser__title">El router te está preguntando</span>
        </div>
        <p className="askuser__q">{question}</p>
        <textarea
          ref={ref}
          className="askuser__input"
          placeholder="Tu respuesta…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          rows={3}
        />
        <div className="askuser__foot">
          <span className="askuser__hint">{hk("↵")} para responder · el router está esperando</span>
          <button className="askuser__send" onClick={send} disabled={!text.trim()}>Responder</button>
        </div>
      </div>
    </div>
  );
}
