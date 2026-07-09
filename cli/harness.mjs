#!/usr/bin/env node
// harness.mjs — Capa de orquestación router+worker AGNÓSTICA al agente.
//
// El router y el worker pueden ser CUALQUIER agente-CLI (claude, codex, opencode)
// vía la capa de adapters/. Podés incluso mezclar: router=claude, worker=codex.
//
// Uso:
//   node harness.mjs "objetivo de alto nivel"
//   ROUTER=claude:opus WORKER=codex node harness.mjs "..."
//   ROUTER=claude WORKER=opencode:anthropic/claude-sonnet-4-6 node harness.mjs "..."
//
// Config por env:
//   ROUTER / WORKER  => "adapter[:model]"  (default: claude:sonnet / claude:sonnet)
//   MAX_ITERS        => tope de iteraciones (default 6)
//   WORKER_TOOLS     => herramientas del worker; vacío = razonador puro
import { randomUUID } from "node:crypto";
import { getAdapter, adapters } from "./adapters/index.mjs";

// ---------- config ----------
const GOAL = process.argv.slice(2).join(" ").trim();
const MAX_ITERS = Number(process.env.MAX_ITERS || 6);
const WORKER_TOOLS = process.env.WORKER_TOOLS; // undefined si no está seteada

// Parsea "adapter:model" -> { adapter, model }. model opcional.
function parseSpec(spec, fallback) {
  const s = (spec || fallback).trim();
  const i = s.indexOf(":");
  return i === -1
    ? { adapter: s, model: undefined }
    : { adapter: s.slice(0, i), model: s.slice(i + 1) };
}

const routerSpec = parseSpec(process.env.ROUTER, "claude:sonnet");
const workerSpec = parseSpec(process.env.WORKER, "claude:sonnet");

if (!GOAL) {
  console.error('Uso: node harness.mjs "objetivo de alto nivel"');
  console.error(`Adapters disponibles: ${Object.keys(adapters).join(", ")}`);
  process.exit(1);
}

const routerAgent = getAdapter(routerSpec.adapter);
const workerAgent = getAdapter(workerSpec.adapter);

// ---------- colores ----------
const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  router: "\x1b[36m", worker: "\x1b[33m",
  ok: "\x1b[32m", err: "\x1b[31m", grey: "\x1b[90m",
};
const banner = (color, who, msg) =>
  console.log(`${color}${c.bold}┏━ ${who}${c.reset}${color} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n${msg}\n`);

// ---------- extraer JSON de la respuesta del router ----------
function parseRouterJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("sin JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

// ---------- preguntar al router con retry + fallback robusto ----------
async function askRouter(prompt, { sessionId, systemPrompt, model }) {
  let cost = 0;
  let r = await routerAgent.run({ prompt, systemPrompt, sessionId, model });
  cost += r.cost;
  try {
    return { decision: parseRouterJSON(r.result), sessionId: r.sessionId, cost };
  } catch {
    const r2 = await routerAgent.run({
      prompt: "Tu última respuesta no fue JSON válido. Reenviá EXACTAMENTE la misma decisión pero como un único objeto JSON con las claves {reasoning,status,instruction,final}, sin markdown ni prosa alrededor.",
      sessionId: r.sessionId, model,
    });
    cost += r2.cost;
    try {
      return { decision: parseRouterJSON(r2.result), sessionId: r2.sessionId, cost };
    } catch {
      return {
        decision: { reasoning: "(router respondió en prosa; interpretado como done)", status: "done", instruction: "", final: r.result },
        sessionId: r2.sessionId, cost,
      };
    }
  }
}

// ---------- roles ----------
const ROUTER_SYSTEM = `Sos un agente ROUTER / orquestador. NUNCA hacés el trabajo vos mismo:
delegás cada tarea a un único agente WORKER y evaluás sus reportes.

En cada turno recibís el objetivo global y (si existe) el último reporte del worker.
Respondé SIEMPRE y SOLO con un objeto JSON, sin prosa alrededor:
{
  "reasoning": "breve análisis de en qué punto estamos",
  "status": "delegate" | "done",
  "instruction": "instrucción concreta y autocontenida para el worker (vacío si done)",
  "final": "resumen final para el usuario (solo si status=done)"
}

Reglas:
- Primer turno (sin reporte): definí la primera instrucción clara.
- Si el reporte del worker resuelve el objetivo con calidad => status="done".
- Si falta pulir/corregir/profundizar => status="delegate" con feedback específico. El worker
  conserva su contexto anterior; referite a su trabajo previo, no repitas todo.
- Máximo ${MAX_ITERS} iteraciones; sé eficiente.
- CRÍTICO: si no hay nada más que delegar, es porque terminaste => status="done" (nunca
  instruction vacío con status="delegate").`;

const WORKER_SYSTEM = `Sos un agente WORKER especializado. Recibís instrucciones de un ROUTER.
Ejecutás la tarea con cuidado y devolvés un REPORTE claro y conciso. Si el router te da
feedback sobre trabajo anterior, iterá sobre ESO (ya tenés el contexto), no empieces de cero.
Terminá con "ESTADO: completo" o "ESTADO: necesito aclaración: <qué>".`;

// ---------- loop principal ----------
async function main() {
  const label = (s, a) => `${s.adapter}${s.model ? ":" + s.model : ""}`;
  console.log(`${c.bold}🧭 Router+Workers harness${c.reset}`);
  console.log(`${c.grey}router = ${c.router}${label(routerSpec)}${c.grey}   worker = ${c.worker}${label(workerSpec)}${c.grey}   max=${MAX_ITERS}${c.reset}`);
  console.log(`${c.bold}Objetivo:${c.reset} ${GOAL}\n`);

  let routerSession = null, workerSession = null, lastReport = null, totalCost = 0;

  for (let iter = 1; iter <= MAX_ITERS; iter++) {
    // 1) ROUTER decide.
    const routerPrompt = routerSession
      ? `Reporte del worker (iteración ${iter - 1}):\n"""\n${lastReport}\n"""\n\n¿Próxima decisión? (JSON)`
      : `Objetivo global:\n"""\n${GOAL}\n"""\n\nPrimer turno, sin reporte todavía. Definí la primera instrucción. (JSON)`;

    const ask = await askRouter(routerPrompt, {
      sessionId: routerSession,
      systemPrompt: routerSession ? undefined : ROUTER_SYSTEM,
      model: routerSpec.model,
    });
    routerSession = ask.sessionId;
    totalCost += ask.cost;
    const decision = ask.decision;

    const instruction = (decision.instruction || "").trim();
    const isDone = decision.status === "done" || instruction === "";

    banner(c.router, `ROUTER · iter ${iter}`,
      `${c.dim}${decision.reasoning || ""}${c.reset}\n` +
      (isDone ? `${c.ok}✔ status: done${c.reset}` : `${c.bold}→ instrucción:${c.reset} ${instruction}`));

    // 2) ¿Terminó?
    if (isDone) {
      banner(c.ok, "RESULTADO FINAL", decision.final || lastReport || "(sin resumen)");
      console.log(`${c.grey}💰 costo total: $${totalCost.toFixed(4)} · iteraciones: ${iter - 1}${c.reset}`);
      console.log(`${c.grey}   router session: ${routerSession}${c.reset}`);
      console.log(`${c.grey}   worker session: ${workerSession}${c.reset}`);
      return;
    }

    // 3) Delegar al WORKER (crear o RESUMIR misma sesión).
    const firstTime = !workerSession;
    const w = await workerAgent.run({
      prompt: instruction,
      systemPrompt: firstTime ? WORKER_SYSTEM : undefined,
      sessionId: workerSession,
      model: workerSpec.model,
      tools: WORKER_TOOLS,
    });
    workerSession = w.sessionId;
    lastReport = w.result;
    totalCost += w.cost;

    banner(c.worker, `WORKER · iter ${iter}${firstTime ? " (nueva sesión)" : " (resume ↺)"}`, lastReport);
  }

  console.log(`${c.err}⚠ Máximo de ${MAX_ITERS} iteraciones sin "done".${c.reset}`);
  console.log(`${c.grey}💰 costo total: $${totalCost.toFixed(4)}${c.reset}`);
}

main().catch((e) => {
  console.error(`${c.err}Fatal:${c.reset} ${e.message}`);
  process.exit(1);
});
