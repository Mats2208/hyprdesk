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
        profile: z
          .string()
          .optional()
          .describe("PREFERIDO: id o nombre de un PERFIL del usuario (mirá list_profiles). Usa su motor/modelo/effort/persona y su color. Si el dominio de la tarea coincide con un perfil, usalo en vez de crear uno genérico."),
        engine: z
          .enum(["claude", "codex", "opencode"])
          .optional()
          .describe("Motor del worker si NO usás un perfil: 'claude' (default), 'codex' u 'opencode'. Si pasás profile, se ignora (manda el motor del perfil)."),
        name: z
          .string()
          .optional()
          .describe("Nombre corto del worker por su DOMINIO (ej. 'frontend', 'backend', 'QA') — para identificarlo después con list_workers. Con perfil, se usa el nombre del perfil."),
      },
    },
    async ({ task, profile, engine, name }) => {
      try {
        const j = await post("/spawn_worker", { prompt: task, profile, engine, name, router: AGENT_ID, cwd: CWD });
        return ok(`Worker "${profile || name || engine || "claude"}" creado con id ${j.workerId}. Está trabajando; te va a avisar cuando termine.`);
      } catch (e) {
        return err(`Error creando worker: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "list_profiles",
    {
      title: "Listar los perfiles/agentes que el usuario definió",
      description:
        "Devuelve los PERFILES de agentes que el usuario configuró para este workspace (id, nombre, motor, modelo, " +
        "descripción de su rol). ANTES de delegar, consultá esto: si hay un perfil cuyo dominio calza con la tarea, " +
        "delegá a ÉL con spawn_worker({profile}). Si no hay ninguno adecuado o dudás cuál usar, preguntale al usuario con ask_user.",
      inputSchema: {},
    },
    async () => {
      try {
        const list = await post("/list_profiles", { router: AGENT_ID });
        if (!Array.isArray(list) || list.length === 0) return ok("El usuario no definió perfiles en este workspace. Podés crear workers genéricos con spawn_worker({engine}).");
        const lines = list.map((p) => `- ${p.name} (id: ${p.id}) · ${p.engine}${p.model ? `/${p.model}` : ""}${p.effort ? ` · ${p.effort}` : ""}${p.desc ? ` — ${p.desc}` : ""}`).join("\n");
        return ok(`Perfiles del usuario (${list.length}):\n${lines}\n\nDelegá con spawn_worker({ profile: "<id o nombre>", task }).`);
      } catch (e) {
        return err(`Error listando perfiles: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "ask_user",
    {
      title: "Preguntarle algo al usuario (bloqueante)",
      description:
        "Le hace una pregunta AL USUARIO y ESPERA su respuesta (bloquea hasta ~5 min). Usalo para decisiones que " +
        "solo el usuario puede tomar: qué perfil usar si dudás, aclarar un requisito ambiguo, confirmar algo " +
        "riesgoso. No lo uses para cosas que podés decidir vos.",
      inputSchema: {
        question: z.string().describe("La pregunta clara y concreta para el usuario."),
      },
    },
    async ({ question }) => {
      try {
        const r = await post("/ask_user", { question, from: AGENT_ID });
        return ok(`El usuario respondió: ${r.answer}`);
      } catch (e) {
        return err(`Error preguntando al usuario: ${e.message}`);
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
        const r = await post("/message", { to: worker_id, from: AGENT_ID, text: message });
        if (r && r.ok === false)
          return err(`No se pudo entregar a ${worker_id}: ${r.error || "destino no disponible"}. Puede haber terminado su proceso — mirá list_workers (si dice "terminó", revisá/mergeá su trabajo o re-delegá a un worker nuevo).`);
        return ok(`Mensaje enviado a ${worker_id}.`);
      } catch (e) {
        return err(`Error enviando al worker: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "review_worker",
    {
      title: "Revisar (criticar) el trabajo de un worker antes de mergear",
      description:
        "Devuelve el DIFF de la rama de un worker (qué cambió vs la rama principal) para que lo REVISES " +
        "antes de integrar. Usalo SIEMPRE antes de merge_worker: leé el diff, verificá que hace lo pedido " +
        "y no rompe nada. Si está bien → merge_worker. Si algo falla → send_to_worker con las correcciones " +
        "(NO mergees). Si querés, corré tests/typecheck vos con shell antes de decidir.",
      inputSchema: {
        worker_id: z.string().describe("El id del worker cuyo trabajo querés revisar."),
      },
    },
    async ({ worker_id }) => {
      try {
        const r = await post("/review_worker", { worker_id });
        if (!r.ok) return err(r.error || "no se pudo revisar");
        const body = r.diff && r.diff.trim() ? r.diff : "(sin cambios en la rama)";
        return ok(`Diff de ${r.branch}:\n\n${r.stat || ""}\n\n${body}\n\n— Si está bien, mergealo con merge_worker. Si no, mandale correcciones con send_to_worker.`);
      } catch (e) {
        return err(`Error revisando: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "merge_worker",
    {
      title: "Mergear la rama de un worker a la principal",
      description:
        "Si el workspace es un repo git, cada worker trabaja en su propia rama/worktree aislada. Cuando " +
        "un worker terminó, REVISÁ primero su trabajo con review_worker; si está bien, llamá a esta tool " +
        "para INTEGRAR su rama a la rama principal del workspace. Devuelve si mergeó o si hubo conflictos " +
        "(con la lista de archivos). Avisale al usuario qué mergeaste.",
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
        const lines = list.map((w) => `- ${w.id} · ${w.name || w.engine} (${w.engine})${w.dead ? " · ⚠️ terminó su proceso (revisá/mergeá o re-delegá; NO le mandes mensajes)" : ""}`).join("\n");
        return ok(`Workers (${list.length}):\n${lines}`);
      } catch (e) {
        return err(`Error listando workers: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "save_memory",
    {
      title: "Guardar tu memoria del workspace (persiste entre sesiones)",
      description:
        "Guardá/actualizá tu MEMORIA de este workspace. Se te re-inyecta al reabrirlo, así retomás con " +
        "contexto. Sobrescribe el doc COMPLETO (mandá el texto entero actualizado, no un fragmento). " +
        "Anotá lo DURADERO: arquitectura y decisiones técnicas, convenciones, dónde está cada cosa, el " +
        "plan por fases, qué está hecho/pendiente, y preferencias del usuario. Conciso, en Markdown. " +
        "Actualizala cuando tomes una decisión importante o cierres una fase.",
      inputSchema: {
        content: z.string().describe("El doc de memoria COMPLETO y actualizado (Markdown conciso)."),
      },
    },
    async ({ content }) => {
      try {
        const r = await post("/save_memory", { cwd: CWD, content });
        if (!r.ok) return err(r.error || "no se pudo guardar la memoria");
        return ok("Memoria del workspace guardada. Se te va a re-inyectar la próxima vez que abras este workspace.");
      } catch (e) {
        return err(`Error guardando memoria: ${e.message}`);
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
        const r = await post("/message", { to: ROUTER_ID, from: AGENT_ID, text: message });
        if (r && r.ok === false)
          return err(`No se pudo entregar el reporte al router: ${r.error || "no disponible"}. El router pudo haber terminado su proceso; reintentá en un momento.`);
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
        const r = await post("/message", { to: ROUTER_ID, from: AGENT_ID, text: `[pregunta] ${question}` });
        if (r && r.ok === false)
          return err(`No se pudo entregar la consulta al router: ${r.error || "no disponible"}.`);
        return ok("Consulta enviada al router.");
      } catch (e) {
        return err(`Error consultando al router: ${e.message}`);
      }
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
