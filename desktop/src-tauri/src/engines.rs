// engines.rs — adaptador de motores de agente (claude / codex / opencode).
// Cada motor arma su propio comando interactivo conectado al MCP "hyprdesk" (el túnel),
// con su rol, su autonomía y su manejo de sesión (claude setea el id; codex/opencode
// generan uno que hay que CAPTURAR luego para poder resumir).
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct AgentSession {
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "sessionId")]
    session_id: String,
}

use crate::home_dir as home;

// Busca el .jsonl de sesión de codex más nuevo (creado tras `since`) cuyo cwd coincida,
// y devuelve su payload.id (uuid).
fn capture_codex(cwd: &str, since: SystemTime) -> Option<String> {
    let root = home().join(".codex").join("sessions");
    let mut best: Option<(SystemTime, String)> = None;
    for entry in walk_jsonl(&root) {
        let Ok(meta) = std::fs::metadata(&entry) else { continue };
        let Ok(mt) = meta.modified() else { continue };
        if mt < since {
            continue;
        }
        // primera línea = session_meta con payload.id y payload.cwd
        if let Ok(content) = std::fs::read_to_string(&entry) {
            if let Some(first) = content.lines().next() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(first) {
                    let p = &v["payload"];
                    if p["cwd"].as_str() == Some(cwd) {
                        if let Some(id) = p["id"].as_str() {
                            if best.as_ref().is_none_or(|(t, _)| mt > *t) {
                                best = Some((mt, id.to_string()));
                            }
                        }
                    }
                }
            }
        }
    }
    best.map(|(_, id)| id)
}

// Busca el ses_<id>.json de opencode más nuevo creado tras `since`.
fn capture_opencode(since: SystemTime) -> Option<String> {
    let root = home().join(".local/share/opencode/storage");
    let mut best: Option<(SystemTime, String)> = None;
    for entry in walk_files(&root) {
        let Some(name) = entry.file_name().map(|n| n.to_string_lossy().to_string()) else { continue };
        if !name.starts_with("ses_") {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&entry) else { continue };
        let Ok(mt) = meta.modified() else { continue };
        if mt < since {
            continue;
        }
        let id = name.trim_end_matches(".json").to_string();
        if best.as_ref().is_none_or(|(t, _)| mt > *t) {
            best = Some((mt, id));
        }
    }
    best.map(|(_, id)| id)
}

fn walk_jsonl(root: &Path) -> Vec<PathBuf> {
    walk_files(root).into_iter().filter(|p| p.extension().is_some_and(|e| e == "jsonl")).collect()
}

// Recorre recursivamente (hasta ~4 niveles) devolviendo archivos.
fn walk_files(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut stack = vec![(root.to_path_buf(), 0u8)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 4 {
            continue;
        }
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push((p, depth + 1));
                } else {
                    out.push(p);
                }
            }
        }
    }
    out
}

// Lanza un hilo que captura el session-id de un agente codex/opencode y emite `agent-session`.
pub fn spawn_capture(app: AppHandle, engine: String, agent_id: String, cwd: String) {
    let since = SystemTime::now() - Duration::from_secs(2); // margen
    thread::spawn(move || {
        for _ in 0..60 {
            thread::sleep(Duration::from_millis(500));
            let sid = match engine.as_str() {
                "codex" => capture_codex(&cwd, since),
                "opencode" => capture_opencode(since),
                _ => None,
            };
            if let Some(session_id) = sid {
                let _ = app.emit("agent-session", AgentSession { agent_id, session_id });
                return;
            }
        }
    });
}

#[derive(Serialize, Clone)]
pub struct LaunchSpec {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>, // env extra (además del whitelist), ej. OPENCODE_CONFIG
    #[serde(rename = "injectTask")]
    pub inject_task: Option<String>, // tarea a inyectar por PTY tras arrancar (opencode)
    pub capture: bool,               // hay que capturar el session-id (codex/opencode)
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>, // conocido de antemano (claude); None si se captura
}

// Directorio de recursos: el MCP bundleado (self-contained) + los roles. Lo setea la app al
// arrancar (apuntando al resource dir de Tauri, que funciona en la app empaquetada); si no está
// seteado (dev), caemos al `resources/` junto al crate, que `pnpm build:agent` genera.
static RES_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_res_dir(dir: PathBuf) {
    let _ = RES_DIR.set(dir);
}

fn res_file(name: &str) -> Result<PathBuf, String> {
    if let Some(base) = RES_DIR.get() {
        let p = base.join(name);
        if p.exists() {
            return Ok(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join(name);
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!("no encuentro el recurso {name} (¿corriste `pnpm build:agent`?)"))
}

// Quita el prefijo UNC `\\?\` que canonicalize agrega en Windows: node/codex no saben cargar
// rutas `\\?\E:\…` (las malinterpretan como `C:\?\E:\…`). En Unix es un no-op.
fn strip_unc(p: PathBuf) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

pub fn mcp_script() -> Result<String, String> {
    let abs = std::fs::canonicalize(res_file("hyprdesk-mcp.mjs")?).map_err(|e| e.to_string())?;
    Ok(strip_unc(abs))
}

pub fn role_text(role: &str) -> Result<String, String> {
    let file = if role == "router" { "router-role.md" } else { "worker-role.md" };
    std::fs::read_to_string(res_file(file)?).map_err(|e| e.to_string())
}

// Env del MCP hyprdesk para un agente (base + extras por rol).
fn mcp_env(port: u16, agent_id: &str, role: &str, cwd: &str, router_id: Option<&str>) -> Vec<(String, String)> {
    let mut e = vec![
        ("HYPRDESK_PORT".to_string(), port.to_string()),
        ("HYPRDESK_AGENT_ID".to_string(), agent_id.to_string()),
        ("HYPRDESK_ROLE".to_string(), role.to_string()),
    ];
    if role == "router" {
        e.push(("HYPRDESK_CWD".to_string(), cwd.to_string())); // para pasar cwd al spawnear workers
    } else if let Some(r) = router_id {
        e.push(("HYPRDESK_ROUTER_ID".to_string(), r.to_string())); // el worker reporta a SU router
    }
    e
}

fn env_object(env: &[(String, String)]) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    for (k, v) in env {
        m.insert(k.clone(), serde_json::Value::String(v.clone()));
    }
    serde_json::Value::Object(m)
}

// Config MCP para claude (archivo por-agente en temp).
fn claude_mcp_config(agent_id: &str, env: &[(String, String)]) -> Result<String, String> {
    let cfg = serde_json::json!({
        "mcpServers": { "hyprdesk": {
            "command": "node",
            "args": [mcp_script()?],
            "env": env_object(env)
        }}
    });
    let path = std::env::temp_dir().join(format!("hyprdesk-mcp-{agent_id}.json"));
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Config opencode (OPENCODE_CONFIG) por-agente: MCP hyprdesk + permisos abiertos (autonomía) +
// el ROL como archivo de `instructions` (se suma al system prompt, no gasta un turno de usuario).
fn opencode_config(agent_id: &str, role_txt: &str, env: &[(String, String)], ask: bool) -> Result<String, String> {
    let role_path = std::env::temp_dir().join(format!("hyprdesk-role-{agent_id}.md"));
    std::fs::write(&role_path, role_txt).map_err(|e| e.to_string())?;
    let perm = if ask { "ask" } else { "allow" }; // "ask" = pide aprobación antes de editar/correr
    let cfg = serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "instructions": [role_path.to_string_lossy()],
        "permission": { "edit": perm, "bash": perm, "webfetch": perm },
        "mcp": { "hyprdesk": {
            "type": "local",
            "command": ["node", mcp_script()?],
            "environment": env_object(env),
            "enabled": true
        }}
    });
    let path = std::env::temp_dir().join(format!("hyprdesk-opencode-{agent_id}.json"));
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ¿Existe realmente el transcript/sesión para poder resumir? (si no, arrancamos fresco).
fn session_exists(engine: &str, cwd: &str, id: &str) -> bool {
    match engine {
        "claude" => {
            // claude escapa el cwd reemplazando separadores por `-`. En Windows además `\` y `:`
            // (C:\a\b → C--a-b); en Unix solo `/` (original — no tocamos paths que puedan tener `:`).
            //
            // strip_verbatim es OBLIGATORIO: el cwd puede venir con el prefijo \\?\ (rutas viejas
            // guardadas por versiones que canonicalizaban). Con él calculábamos --?-E--proj mientras
            // claude escribía en E--proj → el transcript no se encontraba y el --resume se saltaba
            // en silencio: el agente revivía SIN memoria.
            let cwd = crate::paths::strip_verbatim(cwd);
            #[cfg(windows)]
            let escaped = cwd.replace(['/', '\\', ':'], "-");
            #[cfg(not(windows))]
            let escaped = cwd.replace('/', "-");
            home()
                .join(".claude/projects")
                .join(&escaped)
                .join(format!("{id}.jsonl"))
                .exists()
        }
        "codex" => file_with_id_exists(&home().join(".codex/sessions"), id),
        "opencode" => file_with_id_exists(&home().join(".local/share/opencode/storage"), id),
        _ => false,
    }
}

fn file_with_id_exists(root: &Path, id: &str) -> bool {
    walk_files(root)
        .iter()
        .any(|p| p.file_name().is_some_and(|n| n.to_string_lossy().contains(id)))
}

// Opciones de lanzamiento por-agente (de un perfil): modelo, effort de razonamiento, y persona
// (instrucciones extra que se concatenan al rol). Todos opcionales → default = comportamiento actual.
#[derive(Default)]
pub struct AgentOpts<'a> {
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
    pub persona: Option<&'a str>,
    pub skills: &'a [String], // skills de dominio a inyectar además de Ponytail (opt-in por worker)
}

// Compone el rol base con la persona del perfil (si hay).
fn with_persona(base: String, persona: Option<&str>) -> String {
    match persona {
        Some(p) if !p.trim().is_empty() => {
            format!("{base}\n\n--- PERSONA / INSTRUCCIONES DEL PERFIL ---\n\n{p}")
        }
        _ => base,
    }
}

// Nombre saneado a un stem seguro (evita path traversal): solo [a-z0-9-], sin `.md`.
// Único saneador del crate — un segundo es la forma clásica de reintroducir el traversal.
fn stem(name: &str) -> String {
    name.trim().trim_end_matches(".md").to_lowercase()
        .chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect()
}

// Lee un .md de `resources/<dir>/<stem>.md`, trim-eado. None si no está o está vacío.
fn read_md(dir: &str, name: &str) -> Option<String> {
    let s = stem(name);
    if s.is_empty() {
        return None;
    }
    let p = res_file(&format!("{dir}/{s}.md")).ok()?;
    let txt = std::fs::read_to_string(p).ok()?;
    let txt = txt.trim();
    if txt.is_empty() { None } else { Some(txt.to_string()) }
}

fn read_skill(stem: &str) -> Option<String> {
    read_md("skills", stem)
}

// Un playbook (orquestación) lo carga el ROUTER bajo demanda, así que paga contexto solo por el que
// usa. Tope de tamaño con el mismo criterio que la memoria del workspace: el contexto del router es
// el más caro del sistema. Si un playbook llega a este tope, el problema es el playbook — es una
// partitura, no un manual (el dominio va en una skill).
pub fn read_playbook(name: &str) -> Option<String> {
    const MAX: usize = 12_000;
    let txt = read_md("playbooks", name)?;
    if txt.len() <= MAX {
        return Some(txt);
    }
    let cut = txt.char_indices().nth(MAX).map_or(txt.len(), |(i, _)| i);
    Some(format!("{}\n\n… (playbook recortado: excede {MAX} chars)", &txt[..cut]))
}

// Compone el rol con las skills. Ponytail va SIEMPRE (todo agente, todo motor). Las de DOMINIO son
// solo para WORKERS: las "default-on" que el usuario marcó en settings + las `extra` que el router
// pidió al spawnear (perfil o param `skills`). Dedup por stem. Best-effort: si falta un archivo,
// seguimos sin esa skill (no rompe el lanzamiento).
fn with_skills(role_txt: String, extra: &[String], role: &str) -> String {
    use std::collections::HashSet;
    let mut out = role_txt;
    let mut seen: HashSet<String> = HashSet::new();
    if let Some(txt) = read_skill("ponytail") {
        out = format!("{out}\n\n=== SKILL SIEMPRE ACTIVA ===\n\n{txt}");
        seen.insert("ponytail".into());
    }
    // Skills de dominio: solo workers. Router queda con Ponytail (orquesta, no hace trabajo de dominio).
    if role != "worker" {
        return out;
    }
    let mut domain: Vec<String> = crate::settings::load_settings().default_skills; // default-on del usuario
    domain.extend(extra.iter().cloned()); // + las que pidió el router para ESTE worker
    for name in &domain {
        let stem = stem(name);
        if stem.is_empty() || seen.contains(&stem) {
            continue; // vacío/basura o ya inyectada
        }
        if let Some(txt) = read_skill(&stem) {
            out = format!("{out}\n\n=== SKILL DE DOMINIO ({stem}) ===\n\n{txt}");
            seen.insert(stem);
        }
    }
    out
}

// Metadato de una skill de dominio para la UI / el router.
#[derive(Serialize, Clone)]
pub struct SkillInfo {
    pub name: String,    // stem del archivo (frontend, backend, …)
    pub summary: String, // primera línea con texto del .md
}

// Enumera `resources/<dir>/*.md` (nombre + primera línea con texto como resumen), ordenado.
// Directorio ausente → lista vacía: una instalación sin skills/playbooks degrada, no rompe.
fn list_md(dir: &str, skip: &[&str]) -> Vec<SkillInfo> {
    let Ok(root) = res_file(dir) else { return Vec::new() };
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("md") {
                continue;
            }
            let name = match path.file_stem().and_then(|x| x.to_str()) {
                Some(s) if !skip.contains(&s) => s.to_string(),
                _ => continue,
            };
            let summary = std::fs::read_to_string(&path).ok()
                .and_then(|txt| txt.lines()
                    .map(|l| l.trim_start_matches(['#', '>', ' ']).trim().to_string())
                    .find(|l| !l.is_empty()))
                .unwrap_or_default();
            out.push(SkillInfo { name, summary });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

// Skills de DOMINIO (para el hub y para que el router las inyecte al delegar). Ponytail no aparece:
// va siempre en todos.
pub fn list_skills() -> Vec<SkillInfo> {
    list_md("skills", &["ponytail"])
}

// Playbooks de ORQUESTACIÓN (solo para el router: cómo se reparte un tipo de proyecto).
pub fn list_playbooks() -> Vec<SkillInfo> {
    list_md("playbooks", &[])
}

// Rol base + memoria del workspace (solo router): lo que el router guardó en sesiones anteriores se
// le re-inyecta acá para que retome con contexto. Los workers no tienen memoria persistente.
fn role_with_memory(role: &str, cwd: &str) -> Result<String, String> {
    let base = role_text(role)?;
    if role != "router" {
        return Ok(base);
    }
    match crate::memory::read(cwd) {
        Some(mut mem) => {
            // Cap de costo: la memoria se inyecta en CADA sesión del router. Si creció demasiado,
            // la recortamos al inyectar (el archivo queda intacto) para no inflar el contexto base.
            const MAX: usize = 12_000;
            if mem.len() > MAX {
                let cut = mem.char_indices().nth(MAX).map(|(i, _)| i).unwrap_or(mem.len());
                mem.truncate(cut);
                mem.push_str("\n\n… (memoria recortada — mantenela concisa con save_memory)");
            }
            Ok(format!(
                "{base}\n\n--- MEMORIA DE ESTE WORKSPACE (la mantenés vos con save_memory) ---\n\n{mem}"
            ))
        }
        None => Ok(base),
    }
}

// Un motor necesita todos estos datos para armar su comando; meterlos en un struct solo movería
// el ruido de lugar. El lint mide una heurística, no la complejidad real.
#[allow(clippy::too_many_arguments)]
pub fn build_agent(
    engine: &str,
    port: u16,
    agent_id: &str,
    role: &str,
    cwd: &str,
    router_id: Option<&str>,
    resume_id: Option<String>,
    task: Option<&str>,
    opts: &AgentOpts,
) -> Result<LaunchSpec, String> {
    // Fallback: si nos piden resumir una sesión que ya no existe, arrancamos fresca.
    let resume_id = match resume_id {
        Some(id) if session_exists(engine, cwd, &id) => Some(id),
        _ => None,
    };
    let env = mcp_env(port, agent_id, role, cwd, router_id);
    let ask = crate::settings::ask_permission(); // modo "preguntar" vs auto (bypass)
    // Rol final = base + memoria (router) + persona (perfil). Se compone una vez acá.
    let role_txt = with_skills(with_persona(role_with_memory(role, cwd)?, opts.persona), opts.skills, role);
    match engine {
        "claude" => build_claude(agent_id, &role_txt, &env, resume_id, task, opts, ask),
        "codex" => build_codex(&role_txt, cwd, &env, resume_id, task, opts, ask),
        "opencode" => build_opencode(agent_id, &role_txt, &env, resume_id, task, opts, ask),
        other => Err(format!("motor desconocido: {other}")),
    }
}

fn build_claude(
    agent_id: &str,
    role_txt: &str,
    env: &[(String, String)],
    resume_id: Option<String>,
    task: Option<&str>,
    opts: &AgentOpts,
    ask: bool,
) -> Result<LaunchSpec, String> {
    let cfg = claude_mcp_config(agent_id, env)?;
    let (sid, resume) = match resume_id {
        Some(id) => (id, true),
        None => (uuid::Uuid::new_v4().to_string(), false),
    };
    let mut argv = vec!["claude".to_string()];
    if !resume {
        if let Some(t) = task {
            argv.push(t.to_string());
        }
        argv.push("--session-id".to_string());
        argv.push(sid.clone());
    } else {
        argv.push("--resume".to_string());
        argv.push(sid.clone());
    }
    argv.extend([
        "--mcp-config".into(),
        cfg,
        "--strict-mcp-config".into(),
        "--append-system-prompt".into(),
        role_txt.to_string(),
    ]);
    if !ask {
        // modo auto (default): sin prompts de permiso. En modo "ask" NO lo ponemos → claude pregunta.
        argv.push("--dangerously-skip-permissions".into());
    }
    if let Some(m) = opts.model {
        argv.push("--model".into());
        argv.push(m.to_string());
    }
    Ok(LaunchSpec { argv, env: vec![], inject_task: None, capture: false, session_id: Some(sid) })
}

// Claves de trust para codex. Codex resuelve un worktree a la RAÍZ del repo PRINCIPAL para el trust
// (no al cwd del worktree) → un worker que corre en su worktree vuelve a pedir el prompt de confianza
// aunque el cwd esté trusteado. Devolvemos ambas: el cwd y la raíz del repo. En Windows codex es
// case-insensitive y usa backslashes → normalizamos (minúsculas + `\`); en Unix, tal cual.
fn codex_trust_keys(cwd: &str) -> Vec<String> {
    fn norm(p: String) -> String {
        #[cfg(windows)]
        {
            p.replace('/', "\\").to_lowercase()
        }
        #[cfg(not(windows))]
        {
            p
        }
    }
    let mut keys = vec![norm(cwd.to_string())];
    // raíz del repo principal = parent de `--git-common-dir` (en un linked worktree apunta al repo main).
    if let Some(common) = crate::worktree::git(cwd, &["rev-parse", "--path-format=absolute", "--git-common-dir"]) {
        if let Some(root) = std::path::Path::new(common.trim()).parent() {
            let root = norm(root.to_string_lossy().into_owned());
            if !root.is_empty() && !keys.contains(&root) {
                keys.push(root);
            }
        }
    }
    keys
}

fn build_codex(
    role_txt: &str,
    cwd: &str,
    env: &[(String, String)],
    resume_id: Option<String>,
    task: Option<&str>,
    opts: &AgentOpts,
    ask: bool,
) -> Result<LaunchSpec, String> {
    let mcp = mcp_script()?;
    // Flags -c para el MCP hyprdesk inline (env por-agente). Los valores string van con
    // comillas TOML internas; los barewords (node) caen a raw string.
    let mut argv = vec!["codex".to_string()];
    let resume = resume_id.is_some();
    if let Some(id) = &resume_id {
        argv.push("resume".to_string());
        argv.push(id.clone());
        if let Some(t) = task {
            argv.push(t.to_string());
        }
    } else if let Some(t) = task {
        // worker: la tarea SÍ auto-arranca (es su trabajo). El rol NO va como prompt.
        argv.push(t.to_string());
    }
    // router (sin task): no pasamos prompt inicial → arranca idle esperando al usuario,
    // igual que claude con --append-system-prompt. El rol va como developer_instructions (abajo).
    if ask {
        // modo "preguntar": codex pide aprobación antes de comandos, con escritura en el workspace.
        argv.push("--ask-for-approval".to_string());
        argv.push("on-request".to_string());
        argv.push("--sandbox".to_string());
        argv.push("workspace-write".to_string());
    } else {
        argv.push("--dangerously-bypass-approvals-and-sandbox".to_string());
    }
    if let Some(m) = opts.model {
        argv.push("-m".to_string());
        argv.push(m.to_string());
    }
    let mut cfgs = vec![
        "mcp_servers.hyprdesk.command=node".to_string(),
        format!("mcp_servers.hyprdesk.args=[{:?}]", mcp),
        // el rol como INSTRUCCIONES (contexto/developer), no como turno de usuario. Valor raw:
        // codex intenta parsear como TOML, falla (prosa multilínea) y lo usa como string literal.
        format!("developer_instructions={role_txt}"),
    ];
    // Trust: marcamos como confiables el cwd Y la raíz del repo (ver codex_trust_keys) → así el prompt
    // de confianza tampoco aparece en workers que corren en un worktree (codex trustea por repo raíz).
    for tk in codex_trust_keys(cwd) {
        cfgs.push(format!("projects.{tk:?}.trust_level=\"trusted\""));
    }
    if let Some(e) = opts.effort {
        cfgs.push(format!("model_reasoning_effort=\"{e}\""));
    }
    for (k, v) in env {
        cfgs.push(format!("mcp_servers.hyprdesk.env.{k}=\"{v}\""));
    }
    for c in cfgs {
        argv.push("-c".to_string());
        argv.push(c);
    }
    Ok(LaunchSpec {
        argv,
        env: vec![],
        inject_task: None,
        capture: !resume,
        session_id: resume_id,
    })
}

fn build_opencode(
    agent_id: &str,
    role_txt: &str,
    env: &[(String, String)],
    resume_id: Option<String>,
    task: Option<&str>,
    opts: &AgentOpts,
    ask: bool,
) -> Result<LaunchSpec, String> {
    let cfg = opencode_config(agent_id, role_txt, env, ask)?;
    let mut argv = vec!["opencode".to_string()];
    if let Some(m) = opts.model {
        argv.push("-m".to_string());
        argv.push(m.to_string());
    }
    if let Some(id) = &resume_id {
        argv.push("--session".to_string());
        argv.push(id.clone());
    }
    // El rol va como `instructions` (system) en el config → no consume un turno. Solo inyectamos
    // la TAREA (worker) por PTY al arrancar; el router queda idle esperando al usuario.
    let inject = if resume_id.is_some() {
        None
    } else {
        task.map(|t| t.to_string())
    };
    Ok(LaunchSpec {
        argv,
        env: vec![("OPENCODE_CONFIG".to_string(), cfg)],
        inject_task: inject,
        capture: resume_id.is_none(),
        session_id: resume_id,
    })
}
