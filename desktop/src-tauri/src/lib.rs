// PTY manager: abre terminales REALES del SO y las puentea al frontend (xterm.js).
//
// Flujo:
//   frontend  --invoke(pty_spawn)-->  Rust abre un PTY con tu shell adentro
//   PTY stdout --hilo lector-->  evento "pty-output" (bytes en base64) --> xterm.write
//   xterm.onData --invoke(pty_write)-->  se escribe en el stdin del PTY
//   resize / kill igual, por comando.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

mod agent_usage;
mod browser;
mod control;
mod engines;
mod fsops;
mod memory;
mod settings;
mod usage;
mod workspace;
mod worktree;

use base64::Engine;
use control::ControlState;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use sysinfo::System;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

// Home del usuario, multiplataforma. En Unix es $HOME; en Windows %USERPROFILE%
// (con fallback a $HOME por si corre bajo un shell tipo Git Bash que lo setea).
pub(crate) fn home_dir() -> std::path::PathBuf {
    #[cfg(windows)]
    let h = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    #[cfg(not(windows))]
    let h = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(h)
}

// Windows: los CLIs de agente (claude/codex/opencode) se instalan como shims de npm — hay un
// script de shell SIN extensión, un `.cmd` y un `.ps1`, pero el binario real vive en node_modules.
// portable-pty resuelve el script de shell sin extensión (existe) y CreateProcessW no puede
// ejecutarlo → el agente no arranca. Resolvemos el shim `.cmd` a su binario/JS real.
// Devuelve (programa, args_previos). Ej: ("…/claude.exe", []) o ("…/node.exe", ["…/codex.js"]).
#[cfg(windows)]
pub(crate) fn resolve_win_program(arg0: &str) -> (String, Vec<String>) {
    use std::path::{Path, PathBuf};
    // Ya es una ruta concreta que existe → usar tal cual.
    if (arg0.contains('\\') || arg0.contains('/')) && Path::new(arg0).exists() {
        return (arg0.to_string(), vec![]);
    }
    let mut cmd_shim: Option<PathBuf> = None;
    for dir in std::env::split_paths(user_path()) {
        let exe = dir.join(format!("{arg0}.exe"));
        if exe.exists() {
            return (exe.to_string_lossy().into_owned(), vec![]); // .exe directo en PATH (git, node…)
        }
        if cmd_shim.is_none() {
            let cmd = dir.join(format!("{arg0}.cmd"));
            if cmd.exists() {
                cmd_shim = Some(cmd);
            }
        }
    }
    if let Some(shim) = cmd_shim {
        if let Some(res) = parse_npm_cmd_shim(&shim) {
            return res;
        }
    }
    (arg0.to_string(), vec![]) // sin mejor opción; portable-pty lo intentará (y probablemente falle)
}

// Extrae del shim `.cmd` de npm el binario/JS real al que apunta. El shim ejecuta algo como
// `"%dp0%\node_modules\<pkg>\bin\x.exe" %*` o `"node" "%dp0%\node_modules\<pkg>\bin\x.js" %*`.
#[cfg(windows)]
fn parse_npm_cmd_shim(shim: &std::path::Path) -> Option<(String, Vec<String>)> {
    let content = std::fs::read_to_string(shim).ok()?;
    let dir = shim.parent()?;
    // Primer token entrecomillado que apunte a node_modules y termine en .exe o .js = el target.
    let mut raw: Option<String> = None;
    for line in content.lines() {
        for tok in line.split('"') {
            let low = tok.to_ascii_lowercase();
            if low.contains("node_modules") && (low.ends_with(".exe") || low.ends_with(".js")) {
                raw = Some(tok.to_string());
                break;
            }
        }
        if raw.is_some() {
            break;
        }
    }
    // %dp0% / %~dp0 = directorio del shim con separador final.
    let dir_str = format!("{}\\", dir.to_string_lossy().trim_end_matches('\\'));
    let resolved = raw?
        .replace("%~dp0", &dir_str)
        .replace("%dp0%", &dir_str)
        .replace("\\\\", "\\");
    let low = resolved.to_ascii_lowercase();
    if low.ends_with(".exe") {
        Some((resolved, vec![]))
    } else if low.ends_with(".js") {
        // correr con node (preferir el node.exe junto al shim; si no, el del PATH).
        let node = dir.join("node.exe");
        let node = if node.exists() {
            node.to_string_lossy().into_owned()
        } else {
            "node".to_string()
        };
        Some((node, vec![resolved]))
    } else {
        None
    }
}

// PATH real del usuario (resuelto vía login shell en macOS). Necesario porque una app lanzada
// desde Finder/Applications hereda un PATH mínimo (sin nvm) y no encontraría claude/codex/node.
// En Windows ese problema no existe: una app GUI ya hereda el PATH completo (sistema+usuario)
// del registro, así que ahí basta con leer el PATH del proceso.
static USER_PATH: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub(crate) fn user_path() -> &'static str {
    USER_PATH.get_or_init(|| {
        #[cfg(windows)]
        {
            std::env::var("PATH").unwrap_or_default()
        }
        #[cfg(not(windows))]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            let out = std::process::Command::new(&shell)
                .args(["-lic", "printf '__P__%s__E__' \"$PATH\""])
                .output();
            if let Ok(o) = out {
                let s = String::from_utf8_lossy(&o.stdout);
                if let (Some(a), Some(b)) = (s.find("__P__"), s.find("__E__")) {
                    if b > a + 5 {
                        return s[a + 5..b].to_string();
                    }
                }
            }
            std::env::var("PATH").unwrap_or_default()
        }
    })
}

// Spawnea un proceso hijo (git, curl, opencode…) desde una GUI sin consola. En Windows, sin el
// flag CREATE_NO_WINDOW cada hijo de subsistema-consola abre una ventana CMD que parpadea ~1-2s
// (da la impresión de que la app "hace cosas raras"). Este helper la evita. En Unix es un
// passthrough exacto de Command::new — comportamiento idéntico al original.
pub(crate) fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    c
}

// Una sesión de terminal viva.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>, // matar el proceso desde pty_kill (el Child vive en el waiter)
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    // Escribe datos en el stdin del PTY `id`. Lo usa el túnel (control.rs) para
    // inyectar mensajes de un agente en la terminal de otro. Devuelve false si no existe.
    pub fn write(&self, id: &str, data: &str) -> bool {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get_mut(id) {
            let _ = s.writer.write_all(data.as_bytes());
            let _ = s.writer.flush();
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Serialize)]
struct OutputPayload {
    id: String,
    data: String, // bytes crudos del PTY, en base64 (evita corromper UTF-8)
}

// Abre un PTY nuevo corriendo el shell del usuario (interactivo por el tty).
#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    program: Option<String>,
    argv: Option<Vec<String>>,
    env: Option<Vec<(String, String)>>,
    inject_task: Option<String>,
    capture_engine: Option<String>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    // `argv` presente => es un AGENTE (claude). Si no, el login shell interactivo.
    let is_agent = argv.as_ref().map_or(false, |v| !v.is_empty());
    let mut cmd = match &argv {
        Some(av) if !av.is_empty() => {
            // Windows: av[0] (claude/codex/opencode) es un shim de npm; resolvemos su binario real.
            #[cfg(windows)]
            let mut c = {
                let (prog, prefix) = resolve_win_program(&av[0]);
                let mut c = CommandBuilder::new(prog);
                for p in &prefix {
                    c.arg(p);
                }
                c
            };
            #[cfg(not(windows))]
            let mut c = CommandBuilder::new(&av[0]);
            for a in av.iter().skip(1) {
                c.arg(a);
            }
            c
        }
        _ => {
            #[cfg(not(windows))]
            let c = {
                let shell = program
                    .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()));
                let mut c = CommandBuilder::new(shell);
                c.arg("-l"); // login shell
                c
            };
            #[cfg(windows)]
            let c = {
                // Windows no tiene login shells; usamos PowerShell (o el que pida el frontend).
                let shell = program.unwrap_or_else(|| "powershell.exe".into());
                CommandBuilder::new(shell)
            };
            c
        }
    };
    let cwd_str = cwd
        .clone()
        .unwrap_or_else(|| home_dir().to_string_lossy().into_owned());
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    if is_agent {
        // CLAVE: los claude-agente se lanzan con un entorno SANEADO (whitelist).
        // Heredar el entorno completo (contaminado por vars de una sesión claude
        // padre, u otras) hace que claude NO persista su transcript en disco →
        // rompe el --resume. Con este whitelist, la sesión se guarda y se puede resumir.
        cmd.env_clear();
        #[cfg(not(windows))]
        let keys: &[&str] = &[
            "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
            "LC_MESSAGES", "TMPDIR", "SSH_AUTH_SOCK", "COLORTERM",
        ];
        #[cfg(windows)]
        let keys: &[&str] = &[
            // Mínimo para que claude/codex/node funcionen y encuentren ~/.claude en Windows.
            "PATH", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USERNAME",
            "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot", "SystemDrive",
            "ComSpec", "windir", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "COLORTERM",
        ];
        for k in keys {
            if let Ok(v) = std::env::var(k) {
                cmd.env(k, v);
            }
        }
        cmd.env("PATH", user_path()); // PATH real (para encontrar claude/codex/node desde Finder)
        cmd.env("PWD", &cwd_str);
        cmd.env("TERM", "xterm-256color");
        // env extra del motor (ej. OPENCODE_CONFIG)
        if let Some(extra) = &env {
            for (k, v) in extra {
                cmd.env(k, v);
            }
        }
    } else {
        cmd.env("TERM", "xterm-256color");
        cmd.env("PATH", user_path());
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let killer = child.clone_killer(); // para pty_kill (el Child se mueve al hilo waiter)
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    manager.sessions.lock().unwrap().insert(
        id.clone(),
        PtySession { master: pair.master, writer, killer },
    );

    // Waiter: bloquea hasta que el PROCESO muera y emite pty-exit. Necesario porque en Windows
    // (ConPTY) el `read` del PTY NO devuelve EOF cuando el agente hace /exit o Ctrl+C — solo al
    // cerrar el tile. Con child.wait() detectamos la muerte real en cualquier plataforma.
    let app_wait = app.clone();
    let id_wait = id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app_wait.emit("pty-exit", id_wait);
    });

    // Lector → canal → flusher. El lector bloquea leyendo del PTY y manda los chunks por un canal;
    // el flusher los JUNTA en una ventana de ~25ms (o al llegar a 32KB) y emite un solo "pty-output".
    // Con varios agentes streaming a la vez esto baja muchísimo la cantidad de eventos IPC (evita
    // saturar el main thread del webview → sin cuelgues).
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break, // EOF o error => el proceso terminó (se cierra el canal)
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let app2 = app.clone();
    let id2 = id.clone();
    std::thread::spawn(move || {
        use std::sync::mpsc::RecvTimeoutError;
        let mut acc: Vec<u8> = Vec::new();
        let flush = |acc: &mut Vec<u8>| {
            if acc.is_empty() {
                return;
            }
            let data = base64::engine::general_purpose::STANDARD.encode(&acc);
            let _ = app2.emit("pty-output", OutputPayload { id: id2.clone(), data });
            acc.clear();
        };
        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(25)) {
                Ok(chunk) => {
                    acc.extend_from_slice(&chunk);
                    if acc.len() >= 32 * 1024 {
                        flush(&mut acc);
                    }
                }
                Err(RecvTimeoutError::Timeout) => flush(&mut acc),
                Err(RecvTimeoutError::Disconnected) => {
                    flush(&mut acc);
                    break;
                }
            }
        }
        // pty-exit lo emite el hilo waiter (child.wait), no acá: el EOF del reader no es fiable
        // en Windows/ConPTY (no llega al morir el proceso, solo al cerrar el PTY).
    });

    // Inyectar la tarea inicial tras el arranque del TUI (motores sin prompt posicional, ej. opencode).
    if let Some(task) = inject_task {
        let app3 = app.clone();
        let id3 = id.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(6));
            let clean = task.replace('\n', " ").replace('\r', " ");
            let mgr = app3.state::<PtyManager>();
            mgr.write(&id3, &clean);
            std::thread::sleep(std::time::Duration::from_millis(450));
            mgr.write(&id3, "\r");
        });
    }

    // Capturar el session-id generado (codex/opencode) para poder resumir luego.
    if let Some(engine) = capture_engine {
        engines::spawn_capture(app.clone(), engine, id.clone(), cwd_str.clone());
    }

    Ok(())
}

// Escribe las teclas del usuario (o de un agente) en el stdin del PTY.
#[tauri::command]
fn pty_write(manager: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().unwrap();
    if let Some(s) = sessions.get_mut(&id) {
        s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Reajusta el tamaño del PTY cuando el tile cambia de tamaño.
#[tauri::command]
fn pty_resize(manager: State<'_, PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = manager.sessions.lock().unwrap();
    if let Some(s) = sessions.get(&id) {
        s.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Mata la terminal (cerrar tile).
#[tauri::command]
fn pty_kill(manager: State<'_, PtyManager>, id: String) -> Result<(), String> {
    if let Some(mut s) = manager.sessions.lock().unwrap().remove(&id) {
        let _ = s.killer.kill();
    }
    Ok(())
}

// Stats reales del sistema para el header (CPU% global + RAM usada/total en bytes).
#[derive(Serialize)]
struct SysStats {
    cpu: f32,
    mem_used: u64,
    mem_total: u64,
}

#[tauri::command]
fn system_stats(sys: State<'_, Mutex<System>>) -> SysStats {
    let mut s = sys.lock().unwrap();
    s.refresh_cpu_usage();
    s.refresh_memory();
    SysStats {
        cpu: s.global_cpu_usage(),
        mem_used: s.used_memory(),
        mem_total: s.total_memory(),
    }
}

#[derive(Serialize)]
struct AgentLaunch {
    #[serde(rename = "agentId")]
    agent_id: String,
    engine: String,
    argv: Vec<String>,
    env: Vec<(String, String)>,
    #[serde(rename = "injectTask")]
    inject_task: Option<String>,
    capture: bool,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>, // rama del worktree, si aplica
}

// Lanza el agente-router (claude/codex/opencode) interactivo con el MCP hyprdesk, en la
// carpeta del workspace `cwd`. Sesión nueva o `resume_session`.
#[tauri::command]
fn router_launch(
    state: State<'_, ControlState>,
    engine: String,
    cwd: String,
    resume_session: Option<String>,
) -> Result<AgentLaunch, String> {
    // id único por lanzamiento (evita colisiones de tile/PTY al cambiar de workspace).
    // El túnel sigue resolviendo el literal "router" vía este router_id del hub.
    let agent_id = format!("router-{}", uuid::Uuid::new_v4());
    let spec = engines::build_agent(&engine, state.port, &agent_id, "router", &cwd, None, resume_session, None, &engines::AgentOpts::default())?;
    // R3: registrar el router con el cwd de SU workspace (hub por-workspace, sin singletons globales).
    // Un workspace tiene UN router activo: al relanzar (reopen/resume) evictamos el router previo de
    // ESA carpeta, así el mapa no crece sin límite por sesión y la heurística "único router" sigue útil.
    {
        let mut map = state.routers.lock().unwrap();
        map.retain(|_, v| v != &cwd);
        map.insert(agent_id.clone(), cwd.clone());
    }
    Ok(AgentLaunch {
        agent_id,
        engine,
        argv: spec.argv,
        env: spec.env,
        inject_task: spec.inject_task,
        capture: spec.capture,
        session_id: spec.session_id,
        cwd,
        branch: None,
    })
}

// Relanza un worker existente con --resume (al reabrir un workspace).
#[tauri::command]
fn worker_launch(
    state: State<'_, ControlState>,
    engine: String,
    agent_id: String,
    session_id: String,
    cwd: String,                 // worktree del worker si tenía uno; si no, la carpeta del ws
    router_id: String,
    ws_root: Option<String>,     // R4: raíz del workspace (para review/merge git); default = cwd
    branch: Option<String>,      // R4: rama del worktree a restaurar (None si no-git)
) -> Result<AgentLaunch, String> {
    // R4: si el worker tenía worktree pero ya no existe en disco (fue mergeado/limpiado), no
    // podemos resumir ahí → caemos a la carpeta del ws sin rama. Si existe, resumimos en él.
    let ws_root = ws_root.unwrap_or_else(|| cwd.clone());
    let (cwd, branch) = match &branch {
        Some(b) if std::path::Path::new(&cwd).is_dir() => (cwd, Some(b.clone())),
        Some(_) => (ws_root.clone(), None), // worktree perdido → carpeta del ws
        None => (cwd, None),
    };
    let spec = engines::build_agent(&engine, state.port, &agent_id, "worker", &cwd, Some(&router_id), Some(session_id), None, &engines::AgentOpts::default())?;
    // registrar en el roster con su worktree/rama restaurados (así review/merge funcionan tras reabrir)
    state.workers.lock().unwrap().insert(agent_id.clone(), control::WorkerInfo {
        id: agent_id.clone(), engine: engine.clone(), name: agent_id.clone(),
        router_id: router_id.clone(), cwd: cwd.clone(), ws_root: ws_root.clone(), branch: branch.clone(),
        dead: false,
    });
    Ok(AgentLaunch {
        agent_id,
        engine,
        argv: spec.argv,
        env: spec.env,
        inject_task: spec.inject_task,
        capture: spec.capture,
        session_id: spec.session_id,
        cwd,
        branch,
    })
}

// Lanza un worker NUEVO desde un perfil (motor + modelo + effort + persona). Se conecta al hub
// con router_id = el router actual del workspace, así reporta a ese router.
#[tauri::command]
fn spawn_profile_worker(
    state: State<'_, ControlState>,
    engine: String,
    cwd: String,
    router_id: String,
    model: Option<String>,
    effort: Option<String>,
    persona: Option<String>,
    task: Option<String>,
    name: Option<String>,
    skills: Option<Vec<String>>,
) -> Result<AgentLaunch, String> {
    let agent_id = uuid::Uuid::new_v4().to_string();
    let skills = skills.unwrap_or_default();
    let opts = engines::AgentOpts {
        model: model.as_deref(),
        effort: effort.as_deref(),
        persona: persona.as_deref(),
        skills: &skills,
    };
    // ws git → worktree/rama aislada; si no → comparte la carpeta.
    let ws_root = cwd.clone();
    let (agent_cwd, branch) = match worktree::create(&ws_root, &agent_id) {
        Some(wt) => (wt.path, Some(wt.branch)),
        None => (ws_root.clone(), None),
    };
    let spec = engines::build_agent(
        &engine, state.port, &agent_id, "worker", &agent_cwd, Some(&router_id), None, task.as_deref(), &opts,
    )?;
    state.workers.lock().unwrap().insert(agent_id.clone(), control::WorkerInfo {
        id: agent_id.clone(), engine: engine.clone(),
        name: name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| agent_id.clone()),
        router_id: router_id.clone(), cwd: agent_cwd.clone(), ws_root: ws_root.clone(), branch: branch.clone(),
        dead: false,
    });
    Ok(AgentLaunch {
        agent_id,
        engine,
        argv: spec.argv,
        env: spec.env,
        inject_task: spec.inject_task,
        capture: spec.capture,
        session_id: spec.session_id,
        cwd: agent_cwd,
        branch,
    })
}

// ---- roster de workers (para list_workers: el router ve a quién puede reutilizar) ----
#[tauri::command]
fn register_worker(state: State<'_, ControlState>, id: String, engine: String, name: String, router_id: String, cwd: String) {
    state.workers.lock().unwrap().insert(
        id.clone(),
        control::WorkerInfo { id, engine, name, router_id, cwd: cwd.clone(), ws_root: cwd, branch: None, dead: false },
    );
}

// El front registra los perfiles del workspace bajo su router_id → el router los ve con list_profiles.
#[tauri::command]
fn register_profiles(state: State<'_, ControlState>, router_id: String, profiles: Vec<control::ProfileInfo>) {
    state.profiles.lock().unwrap().insert(router_id, profiles);
}

// El usuario respondió una pregunta del router (ask_user) → destraba el canal que espera la respuesta.
#[tauri::command]
fn answer_user(state: State<'_, ControlState>, question_id: String, answer: String) {
    if let Some(tx) = state.questions.lock().unwrap().remove(&question_id) {
        let _ = tx.send(answer);
    }
}

#[tauri::command]
fn unregister_worker(app: AppHandle, state: State<'_, ControlState>, id: String) {
    // El PTY del worker murió. NO borramos su worktree: preservamos su trabajo para que el router
    // pueda revisarlo/mergearlo o recuperarlo (antes lo descartábamos con --force → pérdida silenciosa).
    // Lo marcamos muerto (sigue en el roster para review/merge) y avisamos al router.
    let (router, name, was_alive) = {
        let mut workers = state.workers.lock().unwrap();
        match workers.get_mut(&id) {
            Some(w) => {
                let was_alive = !w.dead;
                w.dead = true;
                (w.router_id.clone(), w.name.clone(), was_alive)
            }
            None => return, // no es un worker del roster (ej. el propio router) → nada que hacer
        }
    };
    if !was_alive {
        return; // ya estaba marcado muerto (evita doble notificación)
    }
    // Notificar al router que su delegado murió (inyección en su PTY, como un mensaje del túnel).
    // El router_id del worker es workspace-correcto (R3); fallback al único router vivo si viniera vacío.
    let target = if router.is_empty() {
        let map = state.routers.lock().unwrap();
        if map.len() == 1 { Some(map.keys().next().unwrap().clone()) } else { None }
    } else {
        Some(router)
    };
    if let Some(target) = target {
        let payload = format!(
            "Mensaje de sistema: ⚠️ El worker \"{name}\" ({id}) terminó su proceso. Su trabajo quedó \
             PRESERVADO — revisalo con review_worker y mergealo si corresponde, o re-delegá la tarea a \
             un worker nuevo. No le mandes mensajes: ya no está vivo."
        );
        let mgr = app.state::<PtyManager>();
        if mgr.write(&target, &payload) {
            let app2 = app.clone();
            let target2 = target.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(350));
                let mgr = app2.state::<PtyManager>();
                mgr.write(&target2, "\r");
            });
        }
    }
}

// Mergea la rama del worker (su worktree) a la rama principal del workspace. Lo llama el router
// (vía MCP) o el usuario (botón). Devuelve {ok} o {ok:false, conflicts:[...]}.
// (no emitimos "merge-result" acá: el front recibe el resultado por el return; el evento "merge-result"
//  es solo para los merges disparados por el ROUTER vía el control server.)
#[tauri::command]
fn merge_worker(state: State<'_, ControlState>, id: String) -> serde_json::Value {
    let info = state.workers.lock().unwrap().get(&id).cloned();
    let (ws_root, wt, branch, dead) = match info {
        Some(w) if w.branch.is_some() => (w.ws_root, w.cwd, w.branch.unwrap(), w.dead),
        _ => return serde_json::json!({ "ok": false, "error": "el worker no tiene worktree (workspace no-git o restaurado)" }),
    };
    match worktree::merge(&ws_root, &wt, &branch) {
        Ok(_) => {
            // Worker muerto ya integrado → recién ACÁ limpiamos su worktree y lo sacamos del roster.
            if dead {
                worktree::remove(&ws_root, &wt);
                state.workers.lock().unwrap().remove(&id);
            }
            serde_json::json!({ "ok": true, "branch": branch })
        }
        Err(conflicts) => serde_json::json!({ "ok": false, "branch": branch, "conflicts": conflicts }),
    }
}

// ---- workspaces ----
#[tauri::command]
fn list_workspaces() -> Vec<workspace::WorkspaceMeta> {
    workspace::list_workspaces()
}

#[tauri::command]
fn create_workspace(name: String) -> Result<workspace::WorkspaceMeta, String> {
    workspace::create_workspace(&name)
}

// Enlaza una carpeta externa existente (proyecto real) como workspace, sin copiarla ni borrarla.
#[tauri::command]
fn link_workspace(folder: String, name: Option<String>) -> Result<workspace::WorkspaceMeta, String> {
    workspace::link_workspace(&folder, name.as_deref())
}

#[tauri::command]
fn load_workspace(folder: String) -> Option<String> {
    workspace::load_state(&folder)
}

#[tauri::command]
fn save_workspace(folder: String, state: String) -> Result<(), String> {
    workspace::save_state(&folder, &state)
}

#[tauri::command]
fn touch_workspace(id: String) {
    workspace::touch_workspace(&id);
}

#[tauri::command]
fn rename_workspace(id: String, name: String) -> Result<(), String> {
    workspace::rename_workspace(&id, &name)
}

#[tauri::command]
fn delete_workspace(id: String) -> Result<(), String> {
    workspace::delete_workspace(&id)
}

// Skills de dominio disponibles (para el hub: selector de perfiles + toggles default-on en Settings).
#[tauri::command]
fn list_skills() -> Vec<engines::SkillInfo> {
    engines::list_skills()
}

// Lee el portapapeles del SO (Cmd+V en un tile). Si hay una IMAGEN, la guarda como PNG en
// temp y devuelve su ruta (los agentes leen rutas de imágenes). Si no, devuelve el texto.
// Devuelve (ruta_imagen?, texto?). Necesario porque el webview no entrega imágenes por el
// evento paste del DOM.
#[tauri::command]
fn paste_clipboard() -> Result<(Option<String>, Option<String>), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    if let Ok(img) = cb.get_image() {
        let (w, h) = (img.width as u32, img.height as u32);
        if let Some(buf) = image::RgbaImage::from_raw(w, h, img.bytes.into_owned()) {
            let path = std::env::temp_dir().join(format!("hyprdesk-paste-{}.png", uuid::Uuid::new_v4()));
            buf.save(&path).map_err(|e| e.to_string())?;
            return Ok((Some(path.to_string_lossy().to_string()), None));
        }
    }
    Ok((None, cb.get_text().ok()))
}

// Copia texto al portapapeles del SO. La usa la terminal (Ctrl+C con selección / Ctrl+Shift+C):
// xterm no copia solo, y en el webview el clipboard API es poco fiable, así que pasamos por arboard.
#[tauri::command]
fn copy_clipboard(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

// Muestra/oculta la barra de menú de la ventana (Windows/Linux): en el home estorba, se muestra al
// entrar a un proyecto. En macOS el menú es global (barra superior del sistema), así que no-op.
#[tauri::command]
fn set_menu_visible(window: tauri::Window, visible: bool) {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = if visible { window.show_menu() } else { window.hide_menu() };
    }
    #[cfg(target_os = "macos")]
    let _ = (window, visible);
}

// Barra de menú nativa de macOS. Los items custom emiten el evento "menu"<action> al frontend
// (que lo mapea a las acciones ya existentes); "new-window" se maneja en Rust. Solo macOS: en
// Windows/Linux la ventana es frameless y el menú lo dibuja el webview (barra de título custom).
#[cfg(target_os = "macos")]
fn build_menu(app: &tauri::App) -> tauri::Result<()> {
    let h = app.handle();
    let settings_item = MenuItem::with_id(h, "settings", "Configuración…", true, Some("CmdOrCtrl+,"))?;
    let app_menu = SubmenuBuilder::new(h, "HyprDesk")
        .about(None)
        .separator()
        .item(&settings_item)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;

    let new_ws = MenuItem::with_id(h, "new-workspace", "Nuevo workspace", true, Some("CmdOrCtrl+N"))?;
    let open_folder = MenuItem::with_id(h, "open-folder", "Abrir carpeta…", true, Some("CmdOrCtrl+O"))?;
    let new_window = MenuItem::with_id(h, "new-window", "Nueva ventana", true, Some("CmdOrCtrl+Shift+N"))?;
    let close_ws = MenuItem::with_id(h, "close-workspace", "Cerrar workspace", true, Some("CmdOrCtrl+Shift+W"))?;
    let file_menu = SubmenuBuilder::new(h, "Archivo")
        .item(&new_ws)
        .item(&open_folder)
        .separator()
        .item(&new_window)
        .separator()
        .item(&close_ws)
        .build()?;

    let edit_menu = SubmenuBuilder::new(h, "Editar")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // Sin accelerator: ⌘B/⌘K ya los maneja el keydown del frontend (evitamos doble disparo).
    let toggle_sidebar = MenuItem::with_id(h, "toggle-sidebar", "Mostrar / ocultar panel", true, None::<&str>)?;
    let palette = MenuItem::with_id(h, "palette", "Comandos…", true, None::<&str>)?;
    let view_menu = SubmenuBuilder::new(h, "Ver")
        .item(&toggle_sidebar)
        .item(&palette)
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(h, "Ventana")
        .minimize()
        .item(&new_window)
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(h)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

// Abre otra ventana (comparte proceso: túnel/PTY globales; cada ventana maneja sus workspaces).
fn open_new_window(app: &AppHandle) {
    let label = format!("win-{}", uuid::Uuid::new_v4().simple());
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("HyprDesk")
        .inner_size(1400.0, 900.0);
    // macOS: title bar overlay (traffic lights sobre el contenido). Windows/Linux: sin decoración
    // (frameless) → la barra de título la dibuja el webview (estilo VS Code).
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    let _ = builder.build();
}

// Abre otra ventana desde el frontend (menú custom "Nueva ventana"). En macOS el menú nativo ya
// llama a open_new_window vía on_menu_event; esto es el equivalente para el menú custom del webview.
#[tauri::command]
fn new_window(app: AppHandle) {
    open_new_window(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::default())
        .manage(Mutex::new(System::new_all()))
        .setup(|app| {
            workspace::ensure_root();
            // Recursos (MCP bundleado + roles). En la app empaquetada viven bajo el resource dir;
            // en dev, `res_file` cae al `resources/` del crate si esto no existe.
            if let Ok(dir) = app.path().resource_dir() {
                engines::set_res_dir(dir.join("resources"));
            }
            let state = control::start(app.handle().clone());
            app.manage(state);
            // macOS: menú global nativo (barra superior del sistema). Windows/Linux: ventana sin
            // decoración → la barra de título (con menú custom + controles) la dibuja el webview.
            #[cfg(target_os = "macos")]
            build_menu(app)?;
            #[cfg(not(target_os = "macos"))]
            for (_, w) in app.webview_windows() {
                let _ = w.set_decorations(false);
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new-window" => open_new_window(app),
            other => {
                // solo a la ventana enfocada (con varias ventanas, evita el doble disparo)
                match app.webview_windows().values().find(|w| w.is_focused().unwrap_or(false)) {
                    Some(win) => { let _ = win.emit("menu", other.to_string()); }
                    None => { let _ = app.emit("menu", other.to_string()); }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_kill, system_stats,
            router_launch, worker_launch, spawn_profile_worker, register_worker, unregister_worker, merge_worker,
            register_profiles, answer_user,
            list_workspaces, create_workspace, link_workspace, load_workspace, save_workspace,
            touch_workspace, rename_workspace, delete_workspace, paste_clipboard, copy_clipboard, set_menu_visible, new_window, list_skills,
            fsops::read_file, fsops::write_file, fsops::list_dir,
            settings::load_settings, settings::save_settings, settings::run_assistant, settings::list_models, settings::glm_usage,
            agent_usage::codex_usage, agent_usage::claude_usage,
            usage::usage_today,
            browser::browser_open, browser::browser_bounds, browser::browser_navigate, browser::browser_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
