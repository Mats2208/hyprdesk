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
    #[serde(default)]
    pub skills: Vec<String>, // skills de dominio fijas de este perfil (se inyectan al lanzarlo)
}

#[derive(Clone)]
pub struct ControlState {
    pub port: u16,
    // R3: hub por-workspace. Antes había singletons globales (router_id/active_cwd) que se pisaban
    // con varios workspaces vivos. Ahora un mapa router_id → cwd del workspace: cada router lleva su
    // propia carpeta, y el destino "router" de un mensaje se resuelve vía el worker emisor.
    pub routers: Arc<Mutex<HashMap<String, String>>>, // router_id → cwd del workspace
    pub workers: Arc<Mutex<HashMap<String, WorkerInfo>>>, // workers vivos (para list_workers)
    pub profiles: Arc<Mutex<HashMap<String, Vec<ProfileInfo>>>>, // perfiles por router_id (para list_profiles)
    pub questions: Arc<Mutex<HashMap<String, std::sync::mpsc::SyncSender<String>>>>, // ask_user pendientes
}

// Un worker recién creado (worktree + comando armado + ya inscripto en el roster).
pub struct SpawnedWorker {
    pub id: String,
    pub engine: String,
    pub title: String,
    pub cwd: String,
    pub branch: Option<String>,
    pub spec: crate::engines::LaunchSpec,
}

impl ControlState {
    // Si hay UN solo router vivo, es ese. Con varios es ambiguo → None (el llamador decide).
    pub fn sole_router(&self) -> Option<String> {
        let map = self.routers.lock().unwrap();
        if map.len() == 1 { map.keys().next().cloned() } else { None }
    }

    // Crea un worker: worktree aislado si el ws es git, arma su comando y lo inscribe en el roster.
    // ÚNICA implementación — la usan tanto el comando Tauri (perfil lanzado por el usuario) como el
    // handler HTTP (worker spawneado por el router). Antes eran dos copias que podían divergir.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_worker(
        &self,
        engine: &str,
        ws_root: &str,
        router: &str,
        model: Option<&str>,
        effort: Option<&str>,
        persona: Option<&str>,
        task: Option<&str>,
        name: Option<&str>,
        skills: &[String],
    ) -> Result<SpawnedWorker, String> {
        let id = uuid::Uuid::new_v4().to_string();
        // ws git → worktree/rama propia (aislamiento); si no → comparte la carpeta del workspace.
        let (cwd, branch) = match crate::worktree::create(ws_root, &id) {
            Some(wt) => (wt.path, Some(wt.branch)),
            None => (ws_root.to_string(), None),
        };
        let opts = crate::engines::AgentOpts { model, effort, persona, skills };
        let spec = crate::engines::build_agent(engine, self.port, &id, "worker", &cwd, Some(router), None, task, &opts)?;
        let title = match name.map(str::trim).filter(|n| !n.is_empty()) {
            Some(n) => format!("{n} · {engine}"),
            None => format!("worker · {engine}"),
        };
        self.workers.lock().unwrap().insert(id.clone(), WorkerInfo {
            id: id.clone(), engine: engine.to_string(), name: title.clone(), router_id: router.to_string(),
            cwd: cwd.clone(), ws_root: ws_root.to_string(), branch: branch.clone(), dead: false,
        });
        Ok(SpawnedWorker { id, engine: engine.to_string(), title, cwd, branch, spec })
    }

    // Mergea la rama del worker a la principal. ÚNICA implementación (comando Tauri = botón del
    // usuario; handler HTTP = merge_worker del router). Un worker muerto ya integrado se limpia acá.
    pub fn merge(&self, id: &str) -> serde_json::Value {
        let info = self.workers.lock().unwrap().get(id).cloned();
        let Some(w) = info else {
            return json!({ "ok": false, "error": "no encuentro ese worker" });
        };
        let Some(branch) = w.branch.clone() else {
            return json!({ "ok": false, "error": "el worker no tiene worktree (workspace no-git o restaurado)" });
        };
        match crate::worktree::merge(&w.ws_root, &w.cwd, &branch) {
            Ok(_) => {
                if w.dead {
                    crate::worktree::remove(&w.ws_root, &w.cwd);
                    self.workers.lock().unwrap().remove(id);
                }
                json!({ "ok": true, "branch": branch })
            }
            Err(conflicts) => json!({ "ok": false, "branch": branch, "conflicts": conflicts }),
        }
    }
}

// Inyecta un mensaje en el PTY de un agente, como si lo tipeara el usuario. false si el PTY no
// existe (agente muerto) → el llamador NO finge éxito.
//
// El Enter va como keystroke SEPARADO tras un delay: pegado al texto, claude lo trata como un
// "paste" y no lo envía. Separado = submit real.
pub fn inject(app: &AppHandle, target: &str, text: &str) -> bool {
    let clean = text.replace('\n', " ").replace('\r', " ");
    let wrote = app.state::<crate::PtyManager>().write(target, &clean);
    if wrote {
        let app = app.clone();
        let target = target.to_string();
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(350));
            app.state::<crate::PtyManager>().write(&target, "\r");
        });
    }
    wrote
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
    #[serde(default)]
    skills: Option<Vec<String>>, // skills de dominio a inyectar en el worker (opt-in)
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
        routers: Arc::new(Mutex::new(HashMap::new())),
        workers: Arc::new(Mutex::new(HashMap::new())),
        profiles: Arc::new(Mutex::new(HashMap::new())),
        questions: Arc::new(Mutex::new(HashMap::new())),
    };
    let state_srv = state.clone();
    thread::spawn(move || {
        for req in server.incoming_requests() {
            let app = app.clone();
            let state = state_srv.clone();
            thread::spawn(move || handle_request(req, app, state));
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

fn handle_request(mut req: tiny_http::Request, app: AppHandle, state: ControlState) {
    let routers = &state.routers;
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
            let result = state.merge(&wid);
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
        "/list_skills" => {
            // skills de dominio disponibles para que el router las elija al delegar (Ponytail no va acá)
            let _ = req.respond(json_response(json!({ "skills": crate::engines::list_skills() }).to_string()));
        }
        "/spawn_worker" => {
            let body = read_body(&mut req);
            let parsed = match serde_json::from_str::<SpawnBody>(&body) {
                Ok(b) => b,
                Err(_) => { let _ = req.respond(Response::from_string("bad json").with_status_code(400)); return; }
            };
            // El router que spawnea manda su id y el cwd de SU workspace (R3). Fallback si no
            // vino el id: si hay UN solo router vivo, es ese; si no, "router".
            let router = parsed
                .router
                .clone()
                .filter(|r| !r.is_empty())
                .or_else(|| state.sole_router())
                .unwrap_or_else(|| "router".into());
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
            // ws_root = cwd que mandó el router; fallback al cwd registrado de ESE router (R3,
            // por-workspace, no un global); último recurso, el home.
            let ws_root = parsed
                .cwd
                .clone()
                .filter(|c| !c.is_empty())
                .or_else(|| routers.lock().unwrap().get(&router).cloned())
                .unwrap_or_else(|| crate::home_dir().to_string_lossy().into_owned());
            // Skills de dominio para este worker: las fijas del perfil (si usó uno) + las que el
            // router pidió en el spawn. Ponytail y las default-on se agregan solas en engines.
            let mut skills = profile.as_ref().map(|p| p.skills.clone()).unwrap_or_default();
            skills.extend(parsed.skills.clone().unwrap_or_default());
            let name = profile.as_ref().map(|p| p.name.clone()).or_else(|| parsed.name.clone());
            let color = profile.as_ref().and_then(|p| p.color.clone());
            let spawned = state.spawn_worker(
                &engine,
                &ws_root,
                &router,
                profile.as_ref().and_then(|p| p.model.as_deref()),
                profile.as_ref().and_then(|p| p.effort.as_deref()),
                profile.as_ref().map(|p| p.persona.as_str()),
                Some(&parsed.prompt),
                name.as_deref(),
                &skills,
            );
            match spawned {
                Ok(w) => {
                    let _ = app.emit(
                        "spawn-agent",
                        SpawnAgentEvent {
                            agent_id: w.id.clone(),
                            title: w.title,
                            engine: w.engine,
                            router,
                            cwd: w.cwd,
                            argv: w.spec.argv,
                            env: w.spec.env,
                            inject_task: w.spec.inject_task,
                            capture: w.spec.capture,
                            session_id: w.spec.session_id,
                            branch: w.branch,
                            color,
                        },
                    );
                    let _ = req.respond(json_response(json!({ "workerId": w.id }).to_string()));
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
            // Resolver el pty destino. "router" es ambiguo con varios workspaces (R3): lo resolvemos
            // vía el worker EMISOR → su router_id (workspace-correcto). Si el emisor no es un worker
            // conocido, caemos a: el único router vivo, si hay uno solo. Si no, el id tal cual.
            let target = if msg.to == "router" {
                workers.lock().unwrap().get(&msg.from).map(|w| w.router_id.clone())
                    .or_else(|| state.sole_router())
            } else {
                Some(msg.to.clone())
            };
            // Entrega = escribir en el PTY destino. Si el PTY no existe (agente muerto), `inject`
            // devuelve false → NO fingimos éxito: le devolvemos el fallo al emisor (R1: acks reales).
            let delivered = match &target {
                Some(target) => {
                    let wrote = inject(&app, target, &format!("Mensaje de {}: {}", msg.from, msg.text));
                    if wrote {
                        // avisar al frontend para que el tile destino "parpadee" (notificación)
                        let _ = app.emit("tile-activity", target.clone());
                    }
                    wrote
                }
                None => false,
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

