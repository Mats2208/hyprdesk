// Onboarding / first-run: explica qué es HyprDesk, los motores, y deja elegir tema. Salteable.
import { useState } from "react";
import { THEMES, THEME_LABEL, useThemeStore } from "../theme/theme";
import { useUiStore } from "../store/uiStore";

const ENGINES = [
  { id: "claude", name: "Claude Code", note: "requerido — instalá y logueá `claude`" },
  { id: "codex", name: "Codex", note: "opcional — `codex`" },
  { id: "opencode", name: "OpenCode", note: "opcional — `opencode`" },
];

export function Welcome() {
  const [step, setStep] = useState(0);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const finish = useUiStore((s) => s.finishOnboarding);

  const steps = [
    {
      title: "Bienvenido a HyprDesk",
      body: (
        <>
          <p className="wel__lead">Un equipo de agentes de IA de código, en tu escritorio.</p>
          <p>Hablás con un agente <b>router</b> que <b>lidera</b>: piensa, diseña y escribe lo crítico, y <b>delega</b> la ejecución a agentes <b>worker</b>, cada uno en su terminal real. Se comunican por un túnel MCP local — <b>A2A (Agent-to-Agent) en tu máquina</b>.</p>
          <div className="wel__flow">
            <span className="wel__node wel__node--router">router</span>
            <span className="wel__arrow">→</span>
            <span className="wel__node">worker</span>
            <span className="wel__node">worker</span>
            <span className="wel__node">worker</span>
          </div>
        </>
      ),
    },
    {
      title: "Motores de agentes",
      body: (
        <>
          <p>Mezclás motores libremente — cada uno puede ser router <b>o</b> worker. Usan el login de su CLI (sin API keys).</p>
          <div className="wel__engines">
            {ENGINES.map((e) => (
              <div key={e.id} className="wel__engine">
                <span className="wel__engine-name">{e.name}</span>
                <span className="wel__engine-note">{e.note}</span>
              </div>
            ))}
          </div>
          <p className="wel__hint">Asegurate de tener al menos <code>claude</code> instalado y logueado antes de lanzar un router.</p>
        </>
      ),
    },
    {
      title: "Elegí tu apariencia",
      body: (
        <>
          <p>Podés cambiarla luego en Configuración (⌘,).</p>
          <div className="wel__themes">
            {THEMES.map((t) => (
              <button key={t} className={`wel__theme ${theme === t ? "wel__theme--on" : ""}`} onClick={() => setTheme(t)}>
                <span className={`wel__swatch wel__swatch--${t}`} />
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
        </>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const s = steps[step];

  return (
    <div className="modal-overlay wel__overlay">
      <div className="wel">
        <div className="wel__dots">
          {steps.map((_, i) => <span key={i} className={`wel__dot ${i === step ? "wel__dot--on" : ""}`} />)}
        </div>
        <h2 className="wel__title">{s.title}</h2>
        <div className="wel__body">{s.body}</div>
        <div className="wel__foot">
          <button className="wel__skip" onClick={finish}>Saltar</button>
          <div className="wel__nav">
            {step > 0 && <button className="wel__back" onClick={() => setStep(step - 1)}>← Atrás</button>}
            <button className="wel__next" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Empezar" : "Siguiente →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
