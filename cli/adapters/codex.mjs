// codex.mjs — adapter para OpenAI Codex CLI (`codex exec`).
//
// Codex no tiene flag de system-prompt, así que lo anteponemos al prompt
// (solo en el primer turno; en resume la sesión ya lo tiene en su contexto).
// Salida: JSONL de eventos. sessionId = thread.started.thread_id;
// texto final = concatenación de los agent_message; cost no viene en USD.
import { spawnCollect, jsonlLines } from "./shared.mjs";

export default {
  name: "codex",
  bin: "codex",
  defaultModel: undefined, // usa el modelo configurado en ~/.codex

  async run({ prompt, systemPrompt, sessionId, model, tools }) {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    // tools presentes => permitir escritura en el workspace; si no, read-only.
    const sandbox = tools ? "workspace-write" : "read-only";
    const base = ["exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox];
    if (model) base.push("-m", model);
    const args = sessionId
      ? [...base, "resume", sessionId, fullPrompt]
      : [...base, fullPrompt];

    const out = await spawnCollect("codex", args);

    let sid = sessionId, texts = [];
    for (const ev of jsonlLines(out)) {
      if (ev.type === "thread.started" && ev.thread_id) sid = ev.thread_id;
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text)
        texts.push(ev.item.text);
    }
    return { result: texts.join("\n").trim(), sessionId: sid, cost: 0 };
  },
};
