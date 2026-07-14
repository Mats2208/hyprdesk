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
        task: z
          .string()
          .describe(
            "El BRIEF del worker — vale lo que valdría el que VOS querrías recibir. Mínimo: (1) QUÉ, concreto; " +
              "(2) DÓNDE: los archivos que este worker POSEE (nadie más los toca) y el contrato/interfaces contra " +
              "los que compila; (3) la RESTRICCIÓN que te haría rechazar el resultado, con su CONSECUENCIA " +
              "('no tweenees la cámara: dos scrubs escribiendo el mismo estado corren carrera'); (4) qué significa " +
              "LISTO, verificable sin vos. Una tarea de dos líneas produce trabajo de dos líneas."
          ),
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
        skills: z
          .array(z.string())
          .optional()
          .describe("Skills de DOMINIO a inyectar en el worker (mirá list_skills). Ponytail va siempre, no la incluyas. Ej: para una tarea de UI, ['frontend']. Solo nombres que devuelva list_skills."),
        persona: z
          .string()
          .optional()
          .describe(
            "ÚLTIMO RECURSO — solo si NINGÚN perfil del usuario (list_profiles) calza con el dominio. Diseñá al agente: " +
              "sus instrucciones permanentes, en 2da persona ('Sos un… trabajás así…'). Es QUIÉN ES, no qué hace hoy " +
              "(eso es la task). El usuario la VE en la app y la puede guardar como perfil suyo, así que escribila como " +
              "si fuera a quedarse. Ignorado si usás profile (manda la persona del perfil)."
          ),
        model: z
          .string()
          .optional()
          .describe("Modelo del motor elegido, si querés uno puntual. Ignorado si usás profile."),
        effort: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Esfuerzo de razonamiento, si el motor lo soporta. Ignorado si usás profile."),
      },
    },
    async ({ task, profile, engine, name, skills, persona, model, effort }) => {
      try {
        const j = await post("/spawn_worker", { prompt: task, profile, engine, name, router: AGENT_ID, cwd: CWD, skills, persona, model, effort });
        const label = profile || name || engine || "claude";
        // El empujón va acá, no en el system prompt: aterriza en el contexto del router en el
        // instante EXACTO del error, es determinístico (array vacío, no una heurística), y no le
        // cuesta una sola línea al prompt. Le gana a cualquier cantidad de prosa preventiva.
        const nudge = skills?.length
          ? ""
          : "\n\n⚠️ Lo creaste SIN skills de dominio. Un worker sin su skill entrega el resultado mediocre que " +
            "podrías haber evitado con una llamada: mirá list_skills y, si alguna calza con su tarea, mandásela " +
            "ahora con send_to_worker o relanzalo.";
        return ok(`Worker "${label}" creado con id ${j.workerId}. Está trabajando; te va a avisar cuando termine.${nudge}`);
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
    "list_skills",
    {
      title: "Listar las skills de dominio disponibles para los workers",
      description:
        "Devuelve las skills de DOMINIO (frontend, backend, testing, etc.) que podés inyectar en un worker al " +
        "delegarle una tarea, vía spawn_worker({ skills: [...] }). Ponytail va SIEMPRE en todos, no aparece acá. " +
        "Consultá esto antes de delegar: si el dominio de la tarea calza con una skill, pasala en spawn_worker " +
        "para que el worker arranque con esa guía. Terminología según motor: 'skill' en claude/opencode, 'plugin' en codex.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await post("/list_skills", {});
        const list = r.skills || [];
        if (!Array.isArray(list) || list.length === 0) return ok("No hay skills de dominio instaladas (solo Ponytail, que ya va siempre).");
        const lines = list.map((s) => `- ${s.name}${s.summary ? ` — ${s.summary}` : ""}`).join("\n");
        return ok(`Skills de dominio disponibles (${list.length}):\n${lines}\n\nInyectalas al delegar: spawn_worker({ task, skills: ["<name>"] }).`);
      } catch (e) {
        return err(`Error listando skills: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "list_playbooks",
    {
      title: "Listar los playbooks de orquestación disponibles",
      description:
        "Un PLAYBOOK dice cómo se ORQUESTA un tipo de proyecto: cómo se parte el trabajo entre workers (un dueño " +
        "por archivo), qué contrato tenés que congelar antes de abrir el abanico, qué worker arranca primero, y " +
        "cuál es la compuerta verificable de 'listo'. NO es conocimiento de dominio (eso son las skills). " +
        "Mirá esto ANTES de planificar un proyecto grande: si hay uno que calza, te ahorra el diseño entero. " +
        "Si NINGUNO calza con lo que te pidieron, NO fuerces uno: planificá sin playbook. Un índice corto no " +
        "significa que tu proyecto tenga que entrar en él.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await post("/list_playbooks", {});
        const list = r.playbooks || [];
        if (!Array.isArray(list) || list.length === 0) return ok("No hay playbooks instalados. Planificá vos el reparto.");
        const lines = list.map((p) => `- ${p.name}${p.summary ? ` — ${p.summary}` : ""}`).join("\n");
        return ok(`Playbooks disponibles (${list.length}):\n${lines}\n\nSi alguno calza con el proyecto: load_playbook("<name>"). Si ninguno calza, planificá sin playbook.`);
      } catch (e) {
        return err(`Error listando playbooks: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "load_playbook",
    {
      title: "Cargar un playbook de orquestación",
      description:
        "Trae el playbook completo (el reparto entre workers, el contrato a congelar, el camino crítico, la " +
        "compuerta de 'listo' y las trampas ya pagadas de ese tipo de proyecto). Cargalo UNA sola vez: ya te " +
        "queda en contexto. Usá solo nombres que devuelva list_playbooks.",
      inputSchema: {
        name: z.string().describe("Nombre del playbook, tal cual lo devuelve list_playbooks."),
      },
    },
    async ({ name }) => {
      try {
        const r = await post("/load_playbook", { name });
        if (!r.ok) {
          const av = (r.available || []).join(", ") || "ninguno";
          return err(`${r.error}. Disponibles: ${av}.`);
        }
        return ok(`PLAYBOOK "${r.name}":\n\n${r.text}`);
      } catch (e) {
        return err(`Error cargando el playbook: ${e.message}`);
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
        "Devuelve el RESUMEN del cambio de un worker: la lista de archivos tocados (--stat) y, si el " +
        "diff es chico, el diff completo inline. Si el diff es grande NO se vuelca entero (te ahorra " +
        "contexto): pedí archivos puntuales con review_file(worker_id, archivo). Usalo SIEMPRE antes de " +
        "merge_worker: mirá qué archivos cambió, inspeccioná los que importen, verificá que hace lo pedido " +
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
        const stat = (r.stat || "").trim();
        if (!stat) return ok(`Rama ${r.branch}: sin cambios.`);
        const inline = r.diff && r.diff.trim();
        const detail = inline
          ? `Diff completo:\n\n${r.diff}`
          : `Diff grande — no lo vuelco entero. Inspeccioná archivos puntuales con review_file(worker_id, "<archivo de la lista>").`;
        return ok(`Cambios de ${r.branch}:\n\n${stat}\n\n${detail}\n\n— Si está bien, mergealo con merge_worker. Si no, mandale correcciones con send_to_worker.`);
      } catch (e) {
        return err(`Error revisando: ${e.message}`);
      }
    }
  );

  server.registerTool(
    "review_file",
    {
      title: "Ver el diff de UN archivo del trabajo de un worker (on-demand)",
      description:
        "Devuelve el diff de un solo archivo de la rama de un worker (vs la rama principal). Usalo tras " +
        "review_worker para inspeccionar archivos puntuales sin volcar todo el diff al contexto. El " +
        "`archivo` es una ruta relativa a la raíz del repo (una de las que listó --stat en review_worker).",
      inputSchema: {
        worker_id: z.string().describe("El id del worker cuyo trabajo querés revisar."),
        file: z.string().describe("Ruta relativa (desde la raíz del repo) del archivo a inspeccionar."),
      },
    },
    async ({ worker_id, file }) => {
      try {
        const r = await post("/review_file", { worker_id, file });
        if (!r.ok) return err(r.error || "no se pudo revisar el archivo");
        const body = r.diff && r.diff.trim() ? r.diff : `(sin cambios en ${r.file})`;
        return ok(`Diff de ${r.file} (${r.branch}):\n\n${body}`);
      } catch (e) {
        return err(`Error revisando el archivo: ${e.message}`);
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
