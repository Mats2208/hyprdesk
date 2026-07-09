// engines.rs — adaptador de motores de agente (claude / codex / opencode).
// Cada motor arma su propio comando interactivo conectado al MCP "hyprdesk" (el túnel),
// con su rol, su autonomía y su manejo de sesión (claude setea el id; codex/opencode
// generan uno que hay que CAPTURAR luego para poder resumir).
use std::path::PathBuf;
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

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
}

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
                            if best.as_ref().map_or(true, |(t, _)| mt > *t) {
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
        if best.as_ref().map_or(true, |(t, _)| mt > *t) {
            best = Some((mt, id));
        }
    }
    best.map(|(_, id)| id)
}

fn walk_jsonl(root: &PathBuf) -> Vec<PathBuf> {
    walk_files(root).into_iter().filter(|p| p.extension().map_or(false, |e| e == "jsonl")).collect()
}

// Recorre recursivamente (hasta ~4 niveles) devolviendo archivos.
fn walk_files(root: &PathBuf) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut stack = vec![(root.clone(), 0u8)];
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

fn manifest() -> &'static str {
    env!("CARGO_MANIFEST_DIR")
}

pub fn mcp_script() -> Result<String, String> {
    std::fs::canonicalize(format!("{}/../mcp/hyprdesk-mcp.mjs", manifest()))
        .map_err(|e| format!("no encuentro hyprdesk-mcp.mjs: {e}"))
        .map(|p| p.to_string_lossy().to_string())
}

pub fn role_text(role: &str) -> Result<String, String> {
    let file = if role == "router" { "router-role.md" } else { "worker-role.md" };
    let p = std::fs::canonicalize(format!("{}/../mcp/{file}", manifest()))
        .map_err(|e| format!("no encuentro {file}: {e}"))?;
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

// Config MCP para claude (archivo por-agente en temp).
fn claude_mcp_config(port: u16, agent_id: &str, role: &str) -> Result<String, String> {
    let cfg = serde_json::json!({
        "mcpServers": { "hyprdesk": {
            "command": "node",
            "args": [mcp_script()?],
            "env": {
                "HYPRDESK_PORT": port.to_string(),
                "HYPRDESK_AGENT_ID": agent_id,
                "HYPRDESK_ROLE": role
            }
        }}
    });
    let path = std::env::temp_dir().join(format!("hyprdesk-mcp-{agent_id}.json"));
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Config opencode (OPENCODE_CONFIG) por-agente: MCP hyprdesk + permisos abiertos (autonomía).
fn opencode_config(port: u16, agent_id: &str, role: &str) -> Result<String, String> {
    let cfg = serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "permission": { "edit": "allow", "bash": "allow", "webfetch": "allow" },
        "mcp": { "hyprdesk": {
            "type": "local",
            "command": ["node", mcp_script()?],
            "environment": {
                "HYPRDESK_PORT": port.to_string(),
                "HYPRDESK_AGENT_ID": agent_id,
                "HYPRDESK_ROLE": role
            },
            "enabled": true
        }}
    });
    let path = std::env::temp_dir().join(format!("hyprdesk-opencode-{agent_id}.json"));
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Prompt inicial con el rol prepended (para motores sin flag de system-prompt).
fn role_prompt(role_txt: &str, task: Option<&str>) -> String {
    match task {
        Some(t) => format!("{role_txt}\n\n--- TU PRIMERA TAREA ---\n\n{t}"),
        None => role_txt.to_string(),
    }
}

// ¿Existe realmente el transcript/sesión para poder resumir? (si no, arrancamos fresco).
fn session_exists(engine: &str, cwd: &str, id: &str) -> bool {
    match engine {
        "claude" => {
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

fn file_with_id_exists(root: &PathBuf, id: &str) -> bool {
    walk_files(root)
        .iter()
        .any(|p| p.file_name().map_or(false, |n| n.to_string_lossy().contains(id)))
}

pub fn build_agent(
    engine: &str,
    port: u16,
    agent_id: &str,
    role: &str,
    cwd: &str,
    resume_id: Option<String>,
    task: Option<&str>,
) -> Result<LaunchSpec, String> {
    // Fallback: si nos piden resumir una sesión que ya no existe, arrancamos fresca.
    let resume_id = match resume_id {
        Some(id) if session_exists(engine, cwd, &id) => Some(id),
        _ => None,
    };
    match engine {
        "claude" => build_claude(port, agent_id, role, resume_id, task),
        "codex" => build_codex(port, agent_id, role, cwd, resume_id, task),
        "opencode" => build_opencode(port, agent_id, role, resume_id, task),
        other => Err(format!("motor desconocido: {other}")),
    }
}

fn build_claude(
    port: u16,
    agent_id: &str,
    role: &str,
    resume_id: Option<String>,
    task: Option<&str>,
) -> Result<LaunchSpec, String> {
    let cfg = claude_mcp_config(port, agent_id, role)?;
    let role_txt = role_text(role)?;
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
        "--dangerously-skip-permissions".into(),
        "--append-system-prompt".into(),
        role_txt,
    ]);
    Ok(LaunchSpec { argv, env: vec![], inject_task: None, capture: false, session_id: Some(sid) })
}

fn build_codex(
    port: u16,
    agent_id: &str,
    role: &str,
    cwd: &str,
    resume_id: Option<String>,
    task: Option<&str>,
) -> Result<LaunchSpec, String> {
    let mcp = mcp_script()?;
    let role_txt = role_text(role)?;
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
    } else {
        // prompt inicial = rol (+ tarea si es worker)
        argv.push(role_prompt(&role_txt, task));
    }
    argv.push("--dangerously-bypass-approvals-and-sandbox".to_string());
    let cfgs = [
        "mcp_servers.hyprdesk.command=node".to_string(),
        format!("mcp_servers.hyprdesk.args=[{:?}]", mcp),
        format!("mcp_servers.hyprdesk.env.HYPRDESK_PORT=\"{port}\""),
        format!("mcp_servers.hyprdesk.env.HYPRDESK_ROLE=\"{role}\""),
        format!("mcp_servers.hyprdesk.env.HYPRDESK_AGENT_ID=\"{agent_id}\""),
        // marcar el cwd como confiable para evitar el prompt de trust
        format!("projects.{cwd:?}.trust_level=\"trusted\""),
    ];
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
    port: u16,
    agent_id: &str,
    role: &str,
    resume_id: Option<String>,
    task: Option<&str>,
) -> Result<LaunchSpec, String> {
    let cfg = opencode_config(port, agent_id, role)?;
    let role_txt = role_text(role)?;
    let mut argv = vec!["opencode".to_string()];
    if let Some(id) = &resume_id {
        argv.push("--session".to_string());
        argv.push(id.clone());
    }
    // opencode TUI no toma mensaje posicional => la tarea/rol se inyecta por PTY al arrancar.
    let inject = if resume_id.is_some() {
        None
    } else {
        Some(role_prompt(&role_txt, task))
    };
    Ok(LaunchSpec {
        argv,
        env: vec![("OPENCODE_CONFIG".to_string(), cfg)],
        inject_task: inject,
        capture: resume_id.is_none(),
        session_id: resume_id,
    })
}
