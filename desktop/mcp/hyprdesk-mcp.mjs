#!/usr/bin/env node
// hyprdesk-mcp.mjs — MCP stdio server que forma el "túnel" entre agentes.
// Role-aware: el ROUTER recibe spawn_worker/send_to_worker; el WORKER recibe
// report_to_router/ask_router. Todas las tools hablan con el control server local
// de la app, que rutea los mensajes inyectándolos en el PTY del agente destino.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PORT = process.env.HYPRDESK_PORT;
const AGENT_ID = process.env.HYPRDESK_AGENT_ID || "unknown";
const ROLE = process.env.HYPRDESK_ROLE || "worker";
const CWD = process.env.HYPRDESK_CWD || null; // carpeta del workspace (routers)
const ROUTER_ID = process.env.HYPRDESK_ROUTER_ID || "router"; // router al que reporta (workers)
const BASE = `http://127.0.0.1:${PORT}`;

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`control server respondió ${res.status}`);
  return res.json();
}

const ok = (text) => ({ content: [{ type: "text", text }] });
const err = (text) => ({ content: [{ type: "text", text }], isError: true });

const server = new McpServer({ name: "hyprdesk", version: "1.0.0" });

if (ROLE === "router") {
  server.registerTool(
    "spawn_worker",
    {
      title: "Crear un worker y delegarle una tarea",
      description:
        "Abre un WORKER (otra terminal viva con su propio agente) y le manda la tarea. Devuelve " +
        "el worker_id. El worker trabaja de forma autónoma y te va a avisar cuando termine " +
        "(recibirás un mensaje suyo). No bloquea.",
      inputSchema: {
        task: z.string().describe("Instrucción autocontenida y completa para el worker (rutas, requisitos, contexto)."),
        engine: z
          .enum(["claude", "codex", "opencode"])
          .optional()
          .describe("Motor del worker: 'claude' (default), 'codex' u 'opencode'. Elegí según la tarea si querés."),
        name: z
          .string()
          .optional()
          .describe("Nombre corto del worker por su DOMINIO (ej. 'frontend', 'backend', 'QA') — para identificarlo después con list_workers."),
      },
    },
    async ({ task, engine, name }) => {
      try {
        const j = await post("/spawn_worker", { prompt: task, engine, name, router: AGENT_ID, cwd: CWD });
        return ok(`Worker "${name || engine || "claude"}" creado con id ${j.workerId}. Está trabajando; te va a avisar cuando termine.`);
      } catch (e) {
        return err(`Error creando worker: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "send_to_worker",
    {
      title: "Mandarle un mensaje/corrección a un worker",
      description:
        "Envía un follow-up, corrección o NUEVA TAREA a un worker EXISTENTE (por su worker_id). " +
        "Preferí esto antes que crear otro worker: el worker conserva todo su contexto/memoria.",
      inputSchema: {
        worker_id: z.string().describe("El id del worker (de spawn_worker o list_workers)."),
        message: z.string().describe("El mensaje/corrección/tarea nueva para el worker."),
      },
    },
    async ({ worker_id, message }) => {
      try {
        await post("/message", { to: worker_id, from: AGENT_ID, text: message });
        return ok(`Mensaje enviado a ${worker_id}.`);
      } catch (e) {
        return err(`Error enviando al worker: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "merge_worker",
    {
      title: "Mergear la rama de un worker a la principal",
      description:
        "Si el workspace es un repo git, cada worker trabaja en su propia rama/worktree aislada. Cuando " +
        "un worker terminó y su trabajo está bien, llamá a esta tool para INTEGRAR su rama a la rama " +
        "principal del workspace. Devuelve si mergeó o si hubo conflictos (con la lista de archivos). " +
        "Avisale al usuario qué mergeaste.",
      inputSchema: {
        worker_id: z.string().describe("El id del worker cuya rama querés integrar."),
      },
    },
    async ({ worker_id }) => {
      try {
        const r = await post("/merge_worker", { worker_id });
        if (r.ok) return ok(`Rama ${r.branch} mergeada a la principal. ✅`);
        if (r.conflicts) return ok(`Conflicto al mergear ${r.branch}. Archivos: ${r.conflicts.join(", ")}. El merge se abortó; hay que resolverlo a mano.`);
        return err(r.error || "no se pudo mergear");
      } catch (e) {
        return err(`Error mergeando: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "list_workers",
    {
      title: "Listar tus workers vivos",
      description:
        "Devuelve los workers que están VIVOS ahora (id, motor, nombre). Consultalo ANTES de crear uno " +
        "nuevo: si ya tenés un worker adecuado, reutilizalo con send_to_worker en vez de spawnear otro.",
      inputSchema: {},
    },
    async () => {
      try {
        const list = await post("/list_workers", { router: AGENT_ID });
        if (!Array.isArray(list) || list.length === 0) return ok("No tenés workers vivos ahora mismo.");
        const lines = list.map((w) => `- ${w.id} · ${w.name || w.engine} (${w.engine})`).join("\n");
        return ok(`Workers vivos (${list.length}):\n${lines}`);
      } catch (e) {
        return err(`Error listando workers: ${e.message}`);
      }
    }
  );
} else {
  server.registerTool(
    "report_to_router",
    {
      title: "Avisarle algo al router",
      description:
        "Le manda un mensaje al ROUTER. Usalo cuando terminás la tarea (con un resumen) o cuando " +
        "el usuario te pidió cambios directos y querés avisar qué hiciste.",
      inputSchema: {
        message: z.string().describe("El reporte/mensaje para el router (resumen claro, rutas, cambios)."),
      },
    },
    async ({ message }) => {
      try {
        await post("/message", { to: ROUTER_ID, from: AGENT_ID, text: message });
        return ok("Reporte enviado al router.");
      } catch (e) {
        return err(`Error reportando al router: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "ask_router",
    {
      title: "Consultarle algo al router",
      description: "Le hace una pregunta al router (la respuesta te va a llegar como un mensaje).",
      inputSchema: {
        question: z.string().describe("La pregunta para el router."),
      },
    },
    async ({ question }) => {
      try {
        await post("/message", { to: ROUTER_ID, from: AGENT_ID, text: `[pregunta] ${question}` });
        return ok("Consulta enviada al router.");
      } catch (e) {
        return err(`Error consultando al router: ${e.message}`);
      }
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
