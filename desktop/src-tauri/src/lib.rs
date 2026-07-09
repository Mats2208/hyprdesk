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

use base64::Engine;
use control::ControlState;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, State};

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
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    // Si viene `argv`, corremos ESE comando directo (ej. un agente headless que
    // termina solo => dispara pty-exit). Si no, el login shell interactivo.
    let mut cmd = match argv {
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
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    // Propagar PATH del proceso padre para que un `argv` como ["claude", ...]
    // encuentre el binario aunque no pase por un login shell.
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
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
struct RouterLaunch {
    #[serde(rename = "agentId")]
    agent_id: String,
    argv: Vec<String>,
    cwd: String,
}

// Lanza el agente-router (v1: claude) interactivo con el MCP hyprdesk (rol router).
// Registra su id en el hub para poder rutearle mensajes de los workers.
#[tauri::command]
fn router_launch(state: State<'_, ControlState>, engine: String) -> Result<RouterLaunch, String> {
    if engine != "claude" {
        return Err(format!("'{engine}' aún no está soportado como router (v1: solo claude)"));
    }
    let agent_id = "router".to_string();
    let (argv, cwd) = control::build_agent(state.port, &agent_id, "router", None)?;
    *state.router_id.lock().unwrap() = Some(agent_id.clone());
    Ok(RouterLaunch { agent_id, argv, cwd })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .manage(Mutex::new(System::new_all()))
        .setup(|app| {
            let state = control::start(app.handle().clone());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_kill, system_stats, router_launch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
