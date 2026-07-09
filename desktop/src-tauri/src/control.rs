// control.rs — control server HTTP local (127.0.0.1) = el "hub" del túnel entre agentes.
//   POST /spawn_worker {prompt}  → crea un worker-tile vivo (emite "spawn-agent"), devuelve {workerId}
//   POST /message {to, from, text} → rutea el mensaje inyectándolo en el PTY del destino (pty_write)
// Cada agente (router / worker) corre un claude interactivo con este MCP conectado.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Response, Server};

static WORKER_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct ControlState {
    pub port: u16,
    pub router_id: Arc<Mutex<Option<String>>>,
}

#[derive(Serialize, Clone)]
struct SpawnAgentEvent {
    #[serde(rename = "agentId")]
    agent_id: String,
    title: String,
    argv: Vec<String>,
    cwd: String,
}

#[derive(Deserialize)]
struct SpawnBody {
    prompt: String,
}

#[derive(Deserialize)]
struct MessageBody {
    to: String,
    from: String,
    text: String,
}

pub fn start(app: AppHandle) -> ControlState {
    let server = Server::http("127.0.0.1:0").expect("no pude iniciar el control server");
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .expect("el control server no expuso puerto IP");
    let router_id: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let router_id_srv = router_id.clone();
    thread::spawn(move || {
        for req in server.incoming_requests() {
            let app = app.clone();
            let router_id = router_id_srv.clone();
            thread::spawn(move || handle_request(req, app, port, router_id));
        }
    });

    ControlState { port, router_id }
}

fn read_body(req: &mut tiny_http::Request) -> String {
    let mut body = String::new();
    let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
    body
}

fn json_response(body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    Response::from_string(body).with_header(header)
}

fn handle_request(
    mut req: tiny_http::Request,
    app: AppHandle,
    port: u16,
    router_id: Arc<Mutex<Option<String>>>,
) {
    let url = req.url().to_string();
    if req.method() != &Method::Post {
        let _ = req.respond(Response::from_string("not found").with_status_code(404));
        return;
    }

    match url.as_str() {
        "/spawn_worker" => {
            let body = read_body(&mut req);
            let prompt = match serde_json::from_str::<SpawnBody>(&body) {
                Ok(b) => b.prompt,
                Err(_) => { let _ = req.respond(Response::from_string("bad json").with_status_code(400)); return; }
            };
            let worker_id = format!("worker-{}", WORKER_COUNTER.fetch_add(1, Ordering::SeqCst));
            match build_agent(port, &worker_id, "worker", Some(&prompt)) {
                Ok((argv, cwd)) => {
                    let _ = app.emit("spawn-agent", SpawnAgentEvent {
                        agent_id: worker_id.clone(),
                        title: format!("worker · claude"),
                        argv,
                        cwd,
                    });
                    let _ = req.respond(json_response(json!({ "workerId": worker_id }).to_string()));
                }
                Err(e) => { let _ = req.respond(Response::from_string(e).with_status_code(500)); }
            }
        }
        "/message" => {
            let body = read_body(&mut req);
            let msg = match serde_json::from_str::<MessageBody>(&body) {
                Ok(m) => m,
                Err(_) => { let _ = req.respond(Response::from_string("bad json").with_status_code(400)); return; }
            };
            // Resolver el pty destino: "router" → router_id; si no, el id tal cual (= pty id).
            let target = if msg.to == "router" {
                router_id.lock().unwrap().clone()
            } else {
                Some(msg.to.clone())
            };
            if let Some(target) = target {
                // Inyectar como un turno nuevo del agente destino (colapsando saltos de línea).
                let clean = msg.text.replace('\n', " ").replace('\r', " ");
                let payload = format!("Mensaje de {}: {}", msg.from, clean);
                {
                    let mgr = app.state::<crate::PtyManager>();
                    mgr.write(&target, &payload);
                }
                // El Enter va como keystroke SEPARADO tras un delay: si va pegado, claude
                // trata todo como un "paste" y no lo envía. Separado = submit real.
                let app2 = app.clone();
                let target2 = target.clone();
                thread::spawn(move || {
                    thread::sleep(std::time::Duration::from_millis(350));
                    let mgr = app2.state::<crate::PtyManager>();
                    mgr.write(&target2, "\r");
                });
            }
            let _ = req.respond(json_response(json!({ "ok": true }).to_string()));
        }
        _ => { let _ = req.respond(Response::from_string("not found").with_status_code(404)); }
    }
}

// ---- construcción del spec de lanzamiento de un agente (claude interactivo + MCP) ----

pub fn agent_mcp_config(port: u16, agent_id: &str, role: &str) -> Result<String, String> {
    let manifest = env!("CARGO_MANIFEST_DIR");
    let mcp_script = std::fs::canonicalize(format!("{manifest}/../mcp/hyprdesk-mcp.mjs"))
        .map_err(|e| format!("no encuentro hyprdesk-mcp.mjs: {e}"))?
        .to_string_lossy()
        .to_string();
    let cfg = json!({
        "mcpServers": {
            "hyprdesk": {
                "command": "node",
                "args": [mcp_script],
                "env": {
                    "HYPRDESK_PORT": port.to_string(),
                    "HYPRDESK_AGENT_ID": agent_id,
                    "HYPRDESK_ROLE": role
                }
            }
        }
    });
    let cfg_path = std::env::temp_dir().join(format!("hyprdesk-mcp-{agent_id}.json"));
    std::fs::write(&cfg_path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(cfg_path.to_string_lossy().to_string())
}

pub fn role_prompt(role: &str) -> Result<String, String> {
    let manifest = env!("CARGO_MANIFEST_DIR");
    let file = if role == "router" { "router-role.md" } else { "worker-role.md" };
    let p = std::fs::canonicalize(format!("{manifest}/../mcp/{file}"))
        .map_err(|e| format!("no encuentro {file}: {e}"))?;
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

// Devuelve (argv, cwd) para lanzar un agente. `initial_task` = primer mensaje (workers).
pub fn build_agent(port: u16, agent_id: &str, role: &str, initial_task: Option<&str>) -> Result<(Vec<String>, String), String> {
    let cfg = agent_mcp_config(port, agent_id, role)?;
    let role_text = role_prompt(role)?;
    let mut argv = vec!["claude".to_string()];
    if let Some(task) = initial_task {
        argv.push(task.to_string());
    }
    argv.extend([
        "--mcp-config".to_string(),
        cfg,
        "--strict-mcp-config".to_string(),
        "--dangerously-skip-permissions".to_string(),
        "--append-system-prompt".to_string(),
        role_text,
    ]);
    let cwd = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    Ok((argv, cwd))
}
