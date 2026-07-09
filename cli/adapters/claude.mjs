// claude.mjs — adapter para Claude Code CLI.
//
// Contrato de todo adapter:
//   run({ prompt, systemPrompt, sessionId, model, tools }) -> { result, sessionId, cost }
//   - sessionId falsy  => crear sesión nueva (devolver el id generado)
//   - sessionId truthy => RESUMIR esa sesión (conserva contexto)
//   - tools: undefined = default del agente; "" = sin herramientas; "Read Bash" = lista
import { spawnCollect } from "./shared.mjs";

export default {
  name: "claude",
  bin: "claude",
  defaultModel: "sonnet",

  async run({ prompt, systemPrompt, sessionId, model, tools }) {
    const args = ["-p", prompt, "--output-format", "json"];
    if (model) args.push("--model", model);
    if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
    if (sessionId) args.push("--resume", sessionId);
    if (tools !== undefined) {
      if (tools === "") args.push("--allowedTools", "");
      else args.push("--allowedTools", ...tools.split(/\s+/), "--dangerously-skip-permissions");
    }
    const j = JSON.parse(await spawnCollect("claude", args));
    return { result: j.result ?? "", sessionId: j.session_id, cost: j.total_cost_usd ?? 0 };
  },
};
