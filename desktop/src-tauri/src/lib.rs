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

mod control;
mod engines;
mod workspace;

use base64::Engine;
use control::ControlState;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, State};

// PATH real del usuario (resuelto vía login shell). Necesario porque una app lanzada
// desde Finder/Applications hereda un PATH mínimo (sin nvm) y no encontraría claude/codex/node.
static USER_PATH: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn user_path() -> &'static str {
    USER_PATH.get_or_init(|| {
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
    })
}

// Una sesión de terminal viva.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
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
            let mut c = CommandBuilder::new(&av[0]);
            for a in av.iter().skip(1) {
                c.arg(a);
            }
            c
        }
        _ => {
            let shell = program
                .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()));
            let mut c = CommandBuilder::new(shell);
            c.arg("-l"); // login shell
            c
        }
    };
    let cwd_str = cwd
        .clone()
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| ".".into()));
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    if is_agent {
        // CLAVE: los claude-agente se lanzan con un entorno SANEADO (whitelist).
        // Heredar el entorno completo (contaminado por vars de una sesión claude
        // padre, u otras) hace que claude NO persista su transcript en disco →
        // rompe el --resume. Con este whitelist, la sesión se guarda y se puede resumir.
        cmd.env_clear();
        for k in [
            "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
            "LC_MESSAGES", "TMPDIR", "SSH_AUTH_SOCK", "COLORTERM",
        ] {
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

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    manager.sessions.lock().unwrap().insert(
        id.clone(),
        PtySession { master: pair.master, writer, child },
    );

    // Hilo lector: bloquea leyendo del PTY y emite cada chunk al frontend.
    let app2 = app.clone();
    let id2 = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break, // EOF o error => el proceso terminó
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app2.emit("pty-output", OutputPayload { id: id2.clone(), data });
                }
            }
        }
        let _ = app2.emit("pty-exit", id2.clone());
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
        let _ = s.child.kill();
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
    let spec = engines::build_agent(&engine, state.port, &agent_id, "router", &cwd, resume_session, None)?;
    *state.router_id.lock().unwrap() = Some(agent_id.clone());
    Ok(AgentLaunch {
        agent_id,
        engine,
        argv: spec.argv,
        env: spec.env,
        inject_task: spec.inject_task,
        capture: spec.capture,
        session_id: spec.session_id,
        cwd,
    })
}

// Relanza un worker existente con --resume (al reabrir un workspace).
#[tauri::command]
fn worker_launch(
    state: State<'_, ControlState>,
    engine: String,
    agent_id: String,
    session_id: String,
    cwd: String,
) -> Result<AgentLaunch, String> {
    let spec = engines::build_agent(&engine, state.port, &agent_id, "worker", &cwd, Some(session_id), None)?;
    Ok(AgentLaunch {
        agent_id,
        engine,
        argv: spec.argv,
        env: spec.env,
        inject_task: spec.inject_task,
        capture: spec.capture,
        session_id: spec.session_id,
        cwd,
    })
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

// Setea la carpeta del workspace activo (el hub la usa como cwd de los workers).
#[tauri::command]
fn set_active_workspace(state: State<'_, ControlState>, folder: String) {
    *state.active_cwd.lock().unwrap() = Some(folder);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .manage(Mutex::new(System::new_all()))
        .setup(|app| {
            workspace::ensure_root();
            let state = control::start(app.handle().clone());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_kill, system_stats,
            router_launch, worker_launch,
            list_workspaces, create_workspace, load_workspace, save_workspace,
            touch_workspace, set_active_workspace, rename_workspace, delete_workspace, paste_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
