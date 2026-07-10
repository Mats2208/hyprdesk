// control.rs — control server HTTP local (127.0.0.1) = el "hub" del túnel entre agentes.
//   POST /spawn_worker {prompt}  → crea un worker-tile vivo (emite "spawn-agent"), devuelve {workerId}
//   POST /message {to, from, text} → rutea el mensaje inyectándolo en el PTY del destino (pty_write)
// Cada agente (router / worker) corre un claude interactivo con este MCP conectado.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Response, Server};

// Info de un worker vivo (roster que el router consulta con list_workers para reutilizar en vez de crear).
#[derive(Clone, Serialize)]
pub struct WorkerInfo {
    pub id: String,
    pub engine: String,
    pub name: String,
    #[serde(rename = "routerId")]
    pub router_id: String,
    pub cwd: String, // cwd del agente (el worktree si aplica)
    #[serde(rename = "wsRoot")]
    pub ws_root: String, // carpeta del workspace (para el merge)
    pub branch: Option<String>, // rama del worktree, si el ws es git
}

#[derive(Clone)]
pub struct ControlState {
    pub port: u16,
    pub router_id: Arc<Mutex<Option<String>>>,
    pub active_cwd: Arc<Mutex<Option<String>>>, // carpeta del workspace abierto
    pub workers: Arc<Mutex<HashMap<String, WorkerInfo>>>, // workers vivos (para list_workers)
}

#[derive(Serialize, Clone)]
struct SpawnAgentEvent {
    #[serde(rename = "agentId")]
    agent_id: String,
    engine: String,
    router: String, // id del router que lo spawneó (para asignar el worker a su workspace)
    title: String,
    cwd: String,
    argv: Vec<String>,
    env: Vec<(String, String)>,
    #[serde(rename = "injectTask")]
    inject_task: Option<String>,
    capture: bool,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    branch: Option<String>, // rama del worktree (para el badge)
}

#[derive(Deserialize)]
struct SpawnBody {
    prompt: String,
    #[serde(default)]
    engine: Option<String>,
    #[serde(default)]
    router: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
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
    let active_cwd: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let workers: Arc<Mutex<HashMap<String, WorkerInfo>>> = Arc::new(Mutex::new(HashMap::new()));

    let router_id_srv = router_id.clone();
    let active_cwd_srv = active_cwd.clone();
    let workers_srv = workers.clone();
    thread::spawn(move || {
        for req in server.incoming_requests() {
            let app = app.clone();
            let router_id = router_id_srv.clone();
            let active_cwd = active_cwd_srv.clone();
            let workers = workers_srv.clone();
            thread::spawn(move || handle_request(req, app, port, router_id, active_cwd, workers));
        }
    });

    ControlState { port, router_id, active_cwd, workers }
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
    active_cwd: Arc<Mutex<Option<String>>>,
    workers: Arc<Mutex<HashMap<String, WorkerInfo>>>,
) {
    let url = req.url().to_string();
    if req.method() != &Method::Post {
        let _ = req.respond(Response::from_string("not found").with_status_code(404));
        return;
    }

    match url.as_str() {
        "/list_workers" => {
            let body = read_body(&mut req);
            let router = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("router").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_default();
            let list: Vec<WorkerInfo> = workers
                .lock()
                .unwrap()
                .values()
                .filter(|w| router.is_empty() || w.router_id == router)
                .cloned()
                .collect();
            let _ = req.respond(json_response(serde_json::to_string(&list).unwrap_or_else(|_| "[]".into())));
        }
        "/merge_worker" => {
            let body = read_body(&mut req);
            let wid = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("worker_id").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_default();
            let info = workers.lock().unwrap().get(&wid).cloned();
            let result = match info {
                Some(w) if w.branch.is_some() => {
                    let branch = w.branch.clone().unwrap();
                    match crate::worktree::merge(&w.ws_root, &w.cwd, &branch) {
                        Ok(_) => json!({ "ok": true, "branch": branch }),
                        Err(conflicts) => json!({ "ok": false, "branch": branch, "conflicts": conflicts }),
                    }
                }
                _ => json!({ "ok": false, "error": "el worker no tiene worktree" }),
            };
            let _ = app.emit("merge-result", result.clone());
            let _ = req.respond(json_response(result.to_string()));
        }
        "/spawn_worker" => {
            let body = read_body(&mut req);
            let parsed = match serde_json::from_str::<SpawnBody>(&body) {
                Ok(b) => b,
                Err(_) => { let _ = req.respond(Response::from_string("bad json").with_status_code(400)); return; }
            };
            let engine = parsed.engine.unwrap_or_else(|| "claude".into());
            let worker_id = uuid::Uuid::new_v4().to_string();
            // El router que spawnea manda su id y el cwd de SU workspace. Con varios
            // workspaces vivos no podemos usar un active_cwd global; caemos a él solo
            // como último recurso.
            let router = parsed.router.clone().unwrap_or_else(|| {
                router_id.lock().unwrap().clone().unwrap_or_else(|| "router".into())
            });
            let ws_root = parsed
                .cwd
                .clone()
                .filter(|c| !c.is_empty())
                .or_else(|| active_cwd.lock().unwrap().clone())
                .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| ".".into()));
            // Si el ws es git → worker en su propio worktree/rama (aislamiento). Si no → comparte carpeta.
            let (cwd, branch) = match crate::worktree::create(&ws_root, &worker_id) {
                Some(wt) => (wt.path, Some(wt.branch)),
                None => (ws_root.clone(), None),
            };
            let title = format!("worker · {engine}");
            match crate::engines::build_agent(&engine, port, &worker_id, "worker", &cwd, Some(&router), None, Some(&parsed.prompt), &crate::engines::AgentOpts::default()) {
                Ok(spec) => {
                    workers.lock().unwrap().insert(worker_id.clone(), WorkerInfo {
                        id: worker_id.clone(), engine: engine.clone(), name: title.clone(),
                        router_id: router.clone(), cwd: cwd.clone(), ws_root: ws_root.clone(), branch: branch.clone(),
                    });
                    let _ = app.emit(
                        "spawn-agent",
                        SpawnAgentEvent {
                            agent_id: worker_id.clone(),
                            title,
                            engine,
                            router,
                            cwd,
                            argv: spec.argv,
                            env: spec.env,
                            inject_task: spec.inject_task,
                            capture: spec.capture,
                            session_id: spec.session_id,
                            branch,
                        },
                    );
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
                // avisar al frontend para que el tile destino "parpadee" (notificación)
                let _ = app.emit("tile-activity", target.clone());
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

