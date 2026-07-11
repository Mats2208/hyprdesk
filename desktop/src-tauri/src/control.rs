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
    #[serde(default)]
    pub dead: bool, // el PTY murió: preservamos su worktree para review/merge/recuperación
}

// Perfil de agente (del workspace) que el router puede consultar (list_profiles) y usar al delegar.
#[derive(Clone, Serialize, Deserialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub engine: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub persona: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Clone)]
pub struct ControlState {
    pub port: u16,
    pub router_id: Arc<Mutex<Option<String>>>,
    pub active_cwd: Arc<Mutex<Option<String>>>, // carpeta del workspace abierto
    pub workers: Arc<Mutex<HashMap<String, WorkerInfo>>>, // workers vivos (para list_workers)
    pub profiles: Arc<Mutex<HashMap<String, Vec<ProfileInfo>>>>, // perfiles por router_id (para list_profiles)
    pub questions: Arc<Mutex<HashMap<String, std::sync::mpsc::SyncSender<String>>>>, // ask_user pendientes
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
    color: Option<String>,  // color del perfil (si el worker vino de un perfil)
}

#[derive(Deserialize)]
struct SpawnBody {
    prompt: String,
    #[serde(default)]
    engine: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    profile: Option<String>, // id o nombre de un perfil del workspace (opcional)
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
    let state = ControlState {
        port,
        router_id: Arc::new(Mutex::new(None)),
        active_cwd: Arc::new(Mutex::new(None)),
        workers: Arc::new(Mutex::new(HashMap::new())),
        profiles: Arc::new(Mutex::new(HashMap::new())),
        questions: Arc::new(Mutex::new(HashMap::new())),
    };
    let state_srv = state.clone();
    thread::spawn(move || {
        for req in server.incoming_requests() {
            let app = app.clone();
            let state = state_srv.clone();
            thread::spawn(move || handle_request(req, app, port, state));
        }
    });

    state
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

fn handle_request(mut req: tiny_http::Request, app: AppHandle, port: u16, state: ControlState) {
    let router_id = &state.router_id;
    let active_cwd = &state.active_cwd;
    let workers = &state.workers;
    let profiles = &state.profiles;
    let questions = &state.questions;
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
                        Ok(_) => {
                            // worker muerto ya integrado → limpiar su worktree y sacarlo del roster.
                            if w.dead {
                                crate::worktree::remove(&w.ws_root, &w.cwd);
                                workers.lock().unwrap().remove(&wid);
                            }
                            json!({ "ok": true, "branch": branch })
                        }
                        Err(conflicts) => json!({ "ok": false, "branch": branch, "conflicts": conflicts }),
                    }
                }
                _ => json!({ "ok": false, "error": "el worker no tiene worktree" }),
            };
            let _ = app.emit("merge-result", result.clone());
            let _ = req.respond(json_response(result.to_string()));
        }
        "/review_worker" => {
            let body = read_body(&mut req);
            let wid = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("worker_id").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_default();
            let info = workers.lock().unwrap().get(&wid).cloned();
            let result = match info {
                Some(w) if w.branch.is_some() => {
                    let branch = w.branch.clone().unwrap();
                    match crate::worktree::review(&w.ws_root, &w.cwd, &branch) {
                        Some((stat, diff)) => json!({ "ok": true, "branch": branch, "stat": stat, "diff": diff }),
                        None => json!({ "ok": false, "error": "no pude generar el diff de la rama" }),
                    }
                }
                // sin worktree (no-git): el worker escribió directo en la carpeta; no hay rama que revisar
                Some(_) => json!({ "ok": false, "error": "el worker no tiene worktree (no es repo git); revisá los archivos directo" }),
                None => json!({ "ok": false, "error": "no encuentro ese worker" }),
            };
            let _ = req.respond(json_response(result.to_string()));
        }
        "/review_file" => {
            let body = read_body(&mut req);
            let parsed = serde_json::from_str::<serde_json::Value>(&body).ok();
            let wid = parsed
                .as_ref()
                .and_then(|v| v.get("worker_id").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_default();
            let file = parsed
                .as_ref()
                .and_then(|v| v.get("file").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_default();
            let info = workers.lock().unwrap().get(&wid).cloned();
            let result = match info {
                Some(w) if w.branch.is_some() => {
                    let branch = w.branch.clone().unwrap();
                    match crate::worktree::review_file(&w.ws_root, &w.cwd, &branch, &file) {
                        Some(diff) => json!({ "ok": true, "branch": branch, "file": file, "diff": diff }),
                        None => json!({ "ok": false, "error": "no pude generar el diff del archivo" }),
                    }
                }
                Some(_) => json!({ "ok": false, "error": "el worker no tiene worktree (no es repo git); revisá los archivos directo" }),
                None => json!({ "ok": false, "error": "no encuentro ese worker" }),
            };
            let _ = req.respond(json_response(result.to_string()));
        }
        "/spawn_worker" => {
            let body = read_body(&mut req);
            let parsed = match serde_json::from_str::<SpawnBody>(&body) {
                Ok(b) => b,
                Err(_) => { let _ = req.respond(Response::from_string("bad json").with_status_code(400)); return; }
            };
            let worker_id = uuid::Uuid::new_v4().to_string();
            // El router que spawnea manda su id y el cwd de SU workspace. Con varios
            // workspaces vivos no podemos usar un active_cwd global; caemos a él solo
            // como último recurso.
            let router = parsed.router.clone().unwrap_or_else(|| {
                router_id.lock().unwrap().clone().unwrap_or_else(|| "router".into())
            });
            // Si el router pidió un PERFIL (por id o nombre), lo resolvemos → motor/modelo/effort/persona/color.
            let profile = parsed.profile.as_ref().and_then(|pid| {
                profiles.lock().unwrap().get(&router).and_then(|list| {
                    list.iter()
                        .find(|p| p.id == *pid || p.name.eq_ignore_ascii_case(pid))
                        .cloned()
                })
            });
            let engine = profile
                .as_ref()
                .map(|p| p.engine.clone())
                .or(parsed.engine.clone())
                .unwrap_or_else(|| "claude".into());
            let ws_root = parsed
                .cwd
                .clone()
                .filter(|c| !c.is_empty())
                .or_else(|| active_cwd.lock().unwrap().clone())
                .unwrap_or_else(|| crate::home_dir().to_string_lossy().into_owned());
            // Si el ws es git → worker en su propio worktree/rama (aislamiento). Si no → comparte carpeta.
            let (cwd, branch) = match crate::worktree::create(&ws_root, &worker_id) {
                Some(wt) => (wt.path, Some(wt.branch)),
                None => (ws_root.clone(), None),
            };
            // Opts del perfil (modelo/effort/persona) — owned para que vivan durante el build.
            let (p_model, p_effort, p_persona) = match &profile {
                Some(p) => (p.model.clone(), p.effort.clone(), Some(p.persona.clone())),
                None => (None, None, None),
            };
            let opts = crate::engines::AgentOpts {
                model: p_model.as_deref(),
                effort: p_effort.as_deref(),
                persona: p_persona.as_deref(),
            };
            let color = profile.as_ref().and_then(|p| p.color.clone());
            let display_name = profile
                .as_ref()
                .map(|p| p.name.clone())
                .or_else(|| parsed.name.clone())
                .filter(|n| !n.trim().is_empty());
            let title = match &display_name {
                Some(n) => format!("{n} · {engine}"),
                None => format!("worker · {engine}"),
            };
            match crate::engines::build_agent(&engine, port, &worker_id, "worker", &cwd, Some(&router), None, Some(&parsed.prompt), &opts) {
                Ok(spec) => {
                    workers.lock().unwrap().insert(worker_id.clone(), WorkerInfo {
                        id: worker_id.clone(), engine: engine.clone(), name: title.clone(),
                        router_id: router.clone(), cwd: cwd.clone(), ws_root: ws_root.clone(), branch: branch.clone(),
                        dead: false,
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
                            color,
                        },
                    );
                    let _ = req.respond(json_response(json!({ "workerId": worker_id }).to_string()));
                }
                Err(e) => {
                    let _ = app.emit("tunnel-error", format!("El router no pudo crear un worker: {e}"));
                    let _ = req.respond(Response::from_string(e).with_status_code(500));
                }
            }
        }
        "/list_profiles" => {
            let body = read_body(&mut req);
            let router = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("router").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_default();
            let list: Vec<serde_json::Value> = profiles
                .lock()
                .unwrap()
                .get(&router)
                .map(|ps| {
                    ps.iter()
                        .map(|p| {
                            // desc corta (no mandamos la persona completa)
                            let desc: String = p.persona.chars().take(180).collect();
                            json!({ "id": p.id, "name": p.name, "engine": p.engine, "model": p.model, "effort": p.effort, "desc": desc })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let _ = req.respond(json_response(serde_json::to_string(&list).unwrap_or_else(|_| "[]".into())));
        }
        "/ask_user" => {
            let body = read_body(&mut req);
            let v = serde_json::from_str::<serde_json::Value>(&body).unwrap_or(json!({}));
            let question = v.get("question").and_then(|q| q.as_str()).unwrap_or("").to_string();
            let from = v.get("from").and_then(|f| f.as_str()).unwrap_or("router").to_string();
            let qid = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = std::sync::mpsc::sync_channel::<String>(1);
            questions.lock().unwrap().insert(qid.clone(), tx);
            let _ = app.emit("ask-user", json!({ "questionId": qid, "question": question, "router": from }));
            // bloquea hasta que el usuario responda (o timeout 5 min).
            let answer = rx
                .recv_timeout(std::time::Duration::from_secs(300))
                .unwrap_or_else(|_| "(el usuario no respondió)".into());
            questions.lock().unwrap().remove(&qid);
            let _ = req.respond(json_response(json!({ "answer": answer }).to_string()));
        }
        "/save_memory" => {
            let body = read_body(&mut req);
            let v = serde_json::from_str::<serde_json::Value>(&body).unwrap_or(json!({}));
            let cwd = v.get("cwd").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let content = v.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let result = if cwd.is_empty() {
                json!({ "ok": false, "error": "sin cwd" })
            } else {
                match crate::memory::write(&cwd, &content) {
                    Ok(_) => json!({ "ok": true }),
                    Err(e) => json!({ "ok": false, "error": e }),
                }
            };
            let _ = req.respond(json_response(result.to_string()));
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
            // Entrega = escribir en el PTY destino. Si el PTY no existe (agente muerto), `write`
            // devuelve false → NO fingimos éxito: le devolvemos el fallo al emisor (R1: acks reales).
            let delivered = if let Some(target) = &target {
                let clean = msg.text.replace('\n', " ").replace('\r', " ");
                let payload = format!("Mensaje de {}: {}", msg.from, clean);
                let wrote = {
                    let mgr = app.state::<crate::PtyManager>();
                    mgr.write(target, &payload)
                };
                if wrote {
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
                wrote
            } else {
                false
            };
            if delivered {
                let _ = req.respond(json_response(json!({ "ok": true }).to_string()));
            } else {
                // dead-letter: avisar al usuario y devolver error al agente emisor.
                let _ = app.emit(
                    "tunnel-error",
                    format!("No se pudo entregar un mensaje a \"{}\" (el agente no está vivo).", msg.to),
                );
                let _ = req.respond(json_response(
                    json!({ "ok": false, "error": "destino no disponible (el agente pudo haber terminado su proceso)" }).to_string(),
                ));
            }
        }
        _ => { let _ = req.respond(Response::from_string("not found").with_status_code(404)); }
    }
}

