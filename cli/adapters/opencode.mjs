// opencode.mjs — adapter para OpenCode CLI (`opencode run`).
//
// Modelo en formato provider/model (ej. "anthropic/claude-sonnet-4-6").
// Salida: JSONL de eventos. sessionID en cada evento; texto final =
// concatenación de las partes type:"text"; cost viene en step_finish.
import { spawnCollect, jsonlLines } from "./shared.mjs";

export default {
  name: "opencode",
  bin: "opencode",
  defaultModel: undefined, // usa el modelo por defecto configurado en opencode

  async run({ prompt, systemPrompt, sessionId, model, tools }) {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    const args = ["run", "--format", "json"];
    if (model) args.push("-m", model);
    if (sessionId) args.push("-s", sessionId);
    if (tools) args.push("--auto"); // auto-aprobar permisos si va a usar herramientas
    args.push(fullPrompt);

    const out = await spawnCollect("opencode", args);

    let sid = sessionId, texts = [], cost = 0;
    for (const ev of jsonlLines(out)) {
      if (ev.sessionID) sid = ev.sessionID;
      if (ev.type === "text" && ev.part?.type === "text" && ev.part.text)
        texts.push(ev.part.text);
      if (ev.type === "step_finish" && typeof ev.part?.cost === "number")
        cost += ev.part.cost;
    }
    return { result: texts.join("").trim(), sessionId: sid, cost };
  },
};
