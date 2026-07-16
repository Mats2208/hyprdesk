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
mod paths;
mod settings;
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

const VENTANA: std::time::Duration = std::time::Duration::from_millis(25);
const TOPE: usize = 32 * 1024;

// Junta la salida del PTY en ventanas de ~25ms (o 32KB) y llama a `emit` UNA vez por ventana. Con
// varios agentes escupiendo a la vez, emitir cada chunk suelto satura el IPC y cuelga el webview.
//
// La clave está en el PRIMER recv(): bloquea INDEFINIDAMENTE. Antes esto era un `recv_timeout(25ms)`
// en loop, así que con el agente en reposo —o sea, la mayor parte del tiempo— el hilo se despertaba
// 40 veces por segundo para no hacer nada. Por CADA agente: con 5 agentes, 200 despertares/segundo
// en vacío.
//
// En CPU% eso no se ve (es despreciable). Pero es exactamente lo que penaliza el modelo de energía
// de macOS: los "idle wakeups" impiden que el core entre en sueño profundo, y eso sí se paga en
// batería. Ahora, en reposo, el hilo duerme de verdad: CERO despertares.
fn coalesce(rx: std::sync::mpsc::Receiver<Vec<u8>>, mut emit: impl FnMut(Vec<u8>)) {
    use std::sync::mpsc::RecvTimeoutError;
    let mut acc: Vec<u8> = Vec::new();
    let mut flush = |acc: &mut Vec<u8>| {
        if !acc.is_empty() {
            emit(std::mem::take(acc));
        }
    };

    // recv() duerme hasta que haya salida. Err = el reader cerró el canal → el PTY murió.
    'vivo: while let Ok(chunk) = rx.recv() {
        acc.extend_from_slice(&chunk);
        let corte = std::time::Instant::now() + VENTANA;
        while acc.len() < TOPE {
            let resta = corte.saturating_duration_since(std::time::Instant::now());
            if resta.is_zero() {
                break;
            }
            match rx.recv_timeout(resta) {
                Ok(chunk) => acc.extend_from_slice(&chunk),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => break 'vivo, // el flush final lo hace abajo
            }
        }
        flush(&mut acc);
    }
    flush(&mut acc); // lo que quedó cuando murió el canal: no se pierde un byte
}

// Abre un PTY nuevo corriendo el shell del usuario (interactivo por el tty).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // la firma ES el contrato IPC con el frontend
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
    let is_agent = argv.as_ref().is_some_and(|v| !v.is_empty());
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
    // strip_verbatim también acá: un cwd con el prefijo \\?\ se le pasa TAL CUAL al proceso hijo, y
    // el usuario abría una terminal en `\\?\E:\proj` en vez de `E:\proj` (PowerShell ni siquiera lo
    // sabe mostrar: escupe `Microsoft.PowerShell.Core\FileSystem::\\?\E:\proj`). El origen ya está
    // arreglado (workspace.rs), pero esto es el borde: nada que salga de acá debe llevar el prefijo.
    let cwd = cwd.map(|c| paths::strip_verbatim(&c));
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
    // El reaper se arma ACÁ y no al morir el hijo: en Windows es un Job Object cuya membresía se
    // hereda al spawnear, así que hay que engancharlo antes de que el hijo tenga tiempo de parir
    // nietos. En unix armar es solo anotar el pid; la simetría es gratis.
    let reaper = child.process_id().and_then(Reaper::arm);
    std::thread::spawn(move || {
        let _ = child.wait();
        // El hijo murió, pero sus NIETOS no. Los barremos acá y no en pty_kill a propósito: este
        // punto cubre las dos muertes —cerrar el tile y un /exit del agente—, que dejan el mismo
        // tendal.
        if let Some(r) = reaper {
            r.reap();
        }
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
        coalesce(rx, |bytes| {
            let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let _ = app2.emit("pty-output", OutputPayload { id: id2.clone(), data });
        });
        // pty-exit lo emite el hilo waiter (child.wait), no acá: el EOF del reader no es fiable
        // en Windows/ConPTY (no llega al morir el proceso, solo al cerrar el PTY).
    });

    // Inyectar la tarea inicial (motores sin prompt posicional: hoy solo opencode; claude y codex la
    // reciben como argv y arrancan con el MCP ya cargado).
    //
    // Esperamos a que EL TÚNEL DE ESTE AGENTE exista — su MCP avisa con /mcp_ready — y recién ahí le
    // hablamos. Antes había un sleep(6s) a ojo: una carrera. Si el MCP tardaba más, el worker
    // empezaba su primer turno SIN las tools del túnel y se quedaba MUDO toda la sesión (no podía
    // report_to_router aunque quisiera: no la tenía). Los workers de opencode perdían esa carrera.
    //
    // Si el aviso no llega (agente sin MCP, o algo raro), a los 30s inyectamos igual: un worker sin
    // túnel puede trabajar, solo que no puede reportar. Peor sería no darle nunca la tarea.
    if let Some(task) = inject_task {
        let app3 = app.clone();
        let id3 = id.clone();
        std::thread::spawn(move || {
            let state = app3.state::<ControlState>();
            let listo = state.wait_for_tunnel(&id3, std::time::Duration::from_secs(30));
            if !listo {
                let _ = app3.emit("tunnel-error", format!("El túnel de {id3} no levantó en 30s: el agente va a trabajar, pero no va a poder reportar."));
            }
            // El túnel está listo, pero el TUI puede seguir dibujando: un respiro antes de tipearle.
            std::thread::sleep(std::time::Duration::from_millis(800));
            control::inject(&app3, &id3, &task);
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

// Barre a los NIETOS del PTY al morir el hijo. portable-pty le hace setsid() al hijo (tiene que ser
// líder de sesión para tomar el tty), así que su pgid == su pid: matar el GRUPO alcanza a todo el
// que siga en él. SIGKILL sin escalar desde TERM: para cuando corremos esto el padre ya murió, y lo
// que queda son huérfanos que no van a atender un apagado ordenado.
//
// LO QUE ESTO ARREGLA, y lo que NO — medido en una Mac, no supuesto:
//   nieto normal          → ya se moría solo (el kernel manda SIGHUP al morir el líder de sesión)
//   nieto que ignora HUP  → SOBREVIVÍA. Esto lo mata. Es el MCP de node que quedaba huérfano.
//   nieto que hace setsid → SOBREVIVE IGUAL: se fue a su propia sesión, killpg no lo alcanza.
//
// Ese último caso es el que importa y sigue abierto: Chromium se lanza detached, así que los cuatro
// `chrome-headless-shell` que un worker dejó pidiendo frames WebGL a 60fps durante horas (80% de un
// Ryzen 9, por una página que nadie miraba) NO los mata esto. Para ésos hace falta caminar el árbol
// de procesos por PPID y matarlos por descendencia. Está en TODO.md; no lo vendo como resuelto.
#[cfg(unix)]
struct Reaper {
    pid: u32,
}

#[cfg(unix)]
impl Reaper {
    fn arm(pid: u32) -> Option<Self> {
        Some(Self { pid })
    }
    fn reap(self) {
        unsafe {
            libc::killpg(self.pid as i32, libc::SIGKILL);
        }
    }
}

// En Windows el barrido es un Job Object con KILL_ON_JOB_CLOSE enganchado al hijo apenas nace: todo
// lo que el hijo spawnee hereda la membresía, y TerminateJobObject se lleva el árbol ENTERO. A
// diferencia de killpg, acá NO hay escape: DETACHED_PROCESS no saca a nadie del job, y el breakaway
// hay que permitirlo explícitamente (no lo permitimos) — así que el caso que en unix sigue abierto
// (Chromium detached, los chrome-headless-shell fantasma) en Windows queda cerrado. Bonus del
// KILL_ON_JOB_CLOSE: si la app entera muere, el kernel cierra sus handles y los árboles de TODOS
// los agentes caen solos.
//
// La ventana que queda: entre el spawn y el AssignProcessToJobObject el hijo podría parir algo que
// nace fuera del job. Milisegundos contra un shell que tarda cientos en arrancar; cerrarla del todo
// pide CREATE_SUSPENDED, que portable-pty no expone. Medido en esta máquina (Windows 11), no
// supuesto: el test de abajo es el mismo escenario que el de unix — un nieto que sobrevive a la
// muerte de su padre (en Windows eso es CUALQUIER nieto: no existe el SIGHUP del kernel).
#[cfg(windows)]
struct Reaper {
    job: isize, // HANDLE crudo como isize: tiene que viajar al hilo waiter (Send)
}

#[cfg(windows)]
impl Reaper {
    fn arm(pid: u32) -> Option<Self> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let seteado = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            // SET_QUOTA + TERMINATE: exactamente lo que AssignProcessToJobObject exige, ni más.
            let proceso = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if seteado == 0 || proceso.is_null() {
                if !proceso.is_null() {
                    CloseHandle(proceso);
                }
                CloseHandle(job);
                return None;
            }
            let asignado = AssignProcessToJobObject(job, proceso);
            CloseHandle(proceso);
            if asignado == 0 {
                CloseHandle(job);
                return None;
            }
            Some(Self { job: job as isize })
        }
    }
    fn reap(self) {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        unsafe {
            // El CloseHandle solo ya mataría todo (KILL_ON_JOB_CLOSE), pero el terminate explícito
            // lo hace AHORA, sin depender de que el nuestro sea el último handle del job.
            TerminateJobObject(self.job as HANDLE, 1);
            CloseHandle(self.job as HANDLE);
        }
    }
}

// Mata la terminal (cerrar tile). Los nietos los barre el hilo waiter al ver morir al hijo (Reaper).
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

impl AgentLaunch {
    fn new(agent_id: String, engine: String, spec: engines::LaunchSpec, cwd: String, branch: Option<String>) -> Self {
        AgentLaunch {
            agent_id,
            engine,
            argv: spec.argv,
            env: spec.env,
            inject_task: spec.inject_task,
            capture: spec.capture,
            session_id: spec.session_id,
            cwd,
            branch,
        }
    }
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
    // Rutas viejas guardadas con el prefijo \\?\ rompen el --resume de claude (ver paths.rs).
    let cwd = paths::strip_verbatim(&cwd);
    let spec = engines::build_agent(&engine, state.port, &agent_id, "router", &cwd, None, resume_session, None, &engines::AgentOpts::default())?;
    // R3: registrar el router con el cwd de SU workspace (hub por-workspace, sin singletons globales).
    // Un workspace tiene UN router activo: al relanzar (reopen/resume) evictamos el router previo de
    // ESA carpeta, así el mapa no crece sin límite por sesión y la heurística "único router" sigue útil.
    {
        let mut map = state.routers.lock().unwrap();
        map.retain(|_, v| v != &cwd);
        map.insert(agent_id.clone(), cwd.clone());
    }
    Ok(AgentLaunch::new(agent_id, engine, spec, cwd, None))
}

// Relanza un worker existente con --resume (al reabrir un workspace).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // la firma ES el contrato IPC con el frontend
fn worker_launch(
    state: State<'_, ControlState>,
    engine: String,
    agent_id: String,
    session_id: String,
    cwd: String,                 // worktree del worker si tenía uno; si no, la carpeta del ws
    router_id: String,
    ws_root: Option<String>,     // R4: raíz del workspace (para review/merge git); default = cwd
    branch: Option<String>,      // R4: rama del worktree a restaurar (None si no-git)
    identity: Option<control::AgentIdentity>, // con qué se lanzó (persona/skills/modelo/task)
) -> Result<AgentLaunch, String> {
    // R4: si el worker tenía worktree pero ya no existe en disco (fue mergeado/limpiado), no
    // podemos resumir ahí → caemos a la carpeta del ws sin rama. Si existe, resumimos en él.
    let cwd = paths::strip_verbatim(&cwd);
    let ws_root = paths::strip_verbatim(&ws_root.unwrap_or_else(|| cwd.clone()));
    let (cwd, branch) = match &branch {
        Some(b) if std::path::Path::new(&cwd).is_dir() => (cwd, Some(b.clone())),
        Some(_) => (ws_root.clone(), None), // worktree perdido → carpeta del ws
        None => (cwd, None),
    };
    // La identidad se REINYECTA. Antes acá iba un AgentOpts::default() —o sea, sin persona ni
    // skills—: al reabrir un workspace, un worker "backend" revivía como un agente genérico. El
    // --resume le devolvía su historial, pero no su rol.
    let ident = identity.unwrap_or_default();
    let spec = engines::build_agent(
        &engine, state.port, &agent_id, "worker", &cwd, Some(&router_id), Some(session_id), None, &ident.opts(),
    )?;
    // registrar en el roster con su worktree/rama restaurados (así review/merge funcionan tras reabrir)
    state.workers.lock().unwrap().insert(agent_id.clone(), control::WorkerInfo {
        id: agent_id.clone(), engine: engine.clone(), name: control::title_for(&ident.name, &engine),
        router_id: router_id.clone(), cwd: cwd.clone(), ws_root, branch: branch.clone(),
        dead: false,
    });
    Ok(AgentLaunch::new(agent_id, engine, spec, cwd, branch))
}

// Lanza un worker NUEVO desde un perfil (motor + modelo + effort + persona). Se conecta al hub
// con router_id = el router actual del workspace, así reporta a ese router.
#[tauri::command]
fn spawn_profile_worker(
    state: State<'_, ControlState>,
    engine: String,
    cwd: String,
    router_id: String,
    identity: control::AgentIdentity,
) -> Result<AgentLaunch, String> {
    let w = state.spawn_worker(&engine, &paths::strip_verbatim(&cwd), &router_id, identity)?;
    Ok(AgentLaunch::new(w.id, w.engine, w.spec, w.cwd, w.branch))
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
    // Su túnel se fue con él. Dejar la marca puesta es una trampa: el id se REUSA al revivir al
    // worker (worker_launch resume con el mismo agent_id), y wait_for_tunnel le diría "listo" a un
    // MCP que todavía no hizo el handshake — el mismo worker mudo que ya arreglamos una vez.
    state.tunnels.lock().unwrap().remove(&id);

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
    let target = Some(router).filter(|r| !r.is_empty()).or_else(|| state.sole_router());
    if let Some(target) = target {
        control::inject(&app, &target, &format!(
            "Mensaje de sistema: ⚠️ El worker \"{name}\" ({id}) terminó su proceso. Su trabajo quedó \
             PRESERVADO — revisalo con review_worker y mergealo si corresponde, o re-delegá la tarea a \
             un worker nuevo. No le mandes mensajes: ya no está vivo."
        ));
    }
}

// Mergea la rama del worker (su worktree) a la principal. Botón del usuario; el router lo hace por
// el túnel (/merge_worker). Misma implementación para los dos (ControlState::merge).
// (no emitimos "merge-result" acá: el front recibe el resultado por el return.)
#[tauri::command]
fn merge_worker(state: State<'_, ControlState>, id: String) -> serde_json::Value {
    state.merge(&id)
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
            // ORDEN OBLIGATORIO, y no es cosmético: gc_orphans() BORRA worktrees, y decide qué es
            // huérfano comparando hash(carpeta) contra los workspaces del índice. ensure_root()
            // normaliza esas carpetas (migra las rutas \\?\ de Windows). Al revés, un workspace con
            // la ruta vieja tiene otro hash → sus worktrees VIVOS se ven huérfanos y se borran.
            workspace::ensure_root();
            worktree::gc_orphans(); // worktrees de workspaces que ya no existen (se acumulaban para siempre)
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
            router_launch, worker_launch, spawn_profile_worker, unregister_worker, merge_worker,
            register_profiles, answer_user,
            list_workspaces, create_workspace, link_workspace, load_workspace, save_workspace,
            touch_workspace, rename_workspace, delete_workspace, paste_clipboard, copy_clipboard, new_window, list_skills,
            fsops::read_file, fsops::write_file, fsops::list_dir,
            settings::load_settings, settings::save_settings, settings::run_assistant, settings::list_models, settings::glm_usage,
            agent_usage::codex_usage, agent_usage::claude_usage,
            browser::browser_open, browser::browser_bounds, browser::browser_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::{Duration, Instant};

    // El nieto que NO se muere solo. Ojo con el caso que se elige acá: un nieto cualquiera ya lo mata
    // el kernel (SIGHUP al morir el líder de sesión), así que un test con `sleep` de nieto PASA
    // aunque el Reaper no haga nada — es un test decorativo. El que de verdad distingue es un nieto
    // que IGNORA SIGHUP: hoy sobrevive, y solo muere si le matamos el grupo. Es el MCP de node que
    // quedaba huérfano. (El que hace setsid se escapa igual — ver Reaper.)
    #[cfg(unix)]
    #[test]
    fn cerrar_una_terminal_se_lleva_al_nieto_que_ignora_sighup() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};

        let pty = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        // Un agente que larga un daemon en background y se queda vivo.
        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("perl -e '$SIG{HUP}=\"IGNORE\"; sleep 30' & echo NIETO=$!; sleep 30");
        let mut child = pty.slave.spawn_command(cmd).unwrap();
        let pid = child.process_id().expect("el hijo del PTY tiene pid");

        // Leer el pid del nieto de la salida del shell.
        let mut reader = pty.master.try_clone_reader().unwrap();
        let mut salida = String::new();
        let mut buf = [0u8; 256];
        let nieto: i32 = loop {
            let n = reader.read(&mut buf).unwrap();
            salida.push_str(&String::from_utf8_lossy(&buf[..n]));
            if let Some(resto) = salida.split("NIETO=").nth(1) {
                let digitos: String = resto.chars().take_while(|c| c.is_ascii_digit()).collect();
                // esperamos al \n para saber que el número está completo
                if !digitos.is_empty() && resto.contains('\n') {
                    break digitos.parse().unwrap();
                }
            }
        };

        let vivo = |p: i32| unsafe { libc::kill(p, 0) == 0 };
        std::thread::sleep(Duration::from_millis(300)); // que alcance a instalar su handler de HUP
        assert!(vivo(nieto), "el nieto tiene que arrancar vivo, si no el test no prueba nada");

        // Lo que hace la app al cerrar el tile: matar al hijo… y después barrer su grupo.
        let reaper = Reaper::arm(pid).expect("en unix armar no falla");
        child.kill().unwrap();
        let _ = child.wait();
        reaper.reap();

        // Huérfano → lo adopta launchd/init, que lo reapea. Le damos hasta 2s para desaparecer.
        let murio = (0..40).any(|_| {
            if vivo(nieto) {
                std::thread::sleep(Duration::from_millis(50));
                false
            } else {
                true
            }
        });
        if !murio {
            unsafe { libc::kill(nieto, libc::SIGKILL) }; // no dejamos el proceso colgado
        }
        assert!(murio, "el nieto ignoró el SIGHUP y sobrevivió: matarle el grupo no funcionó");
    }

    // El espejo Windows del test de arriba, con dos diferencias que importan. Una: acá NO hace falta
    // un nieto especial — no existe el SIGHUP del kernel, así que CUALQUIER nieto sobrevive a la
    // muerte de su padre (por eso "en Windows no se moría ningún nieto"). Dos: el ORDEN. El Reaper
    // se arma ANTES de que el nieto nazca, como en pty_spawn — la membresía del job se hereda al
    // spawnear, así que un job enganchado tarde es un job que no vio nacer a nadie.
    #[cfg(windows)]
    #[test]
    fn cerrar_una_terminal_se_lleva_al_nieto_huerfano() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};

        let pty = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        // Un agente que larga un daemon en background y se queda vivo.
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoProfile");
        cmd.arg("-Command");
        cmd.arg("$p = Start-Process powershell -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command','Start-Sleep 30' -WindowStyle Hidden -PassThru; Write-Output ('NIETO=' + $p.Id); Start-Sleep 30");
        let mut child = pty.slave.spawn_command(cmd).unwrap();
        let pid = child.process_id().expect("el hijo del PTY tiene pid");

        // Como en pty_spawn: el job se engancha apenas nace el hijo. El nieto todavía no existe
        // (powershell tarda cientos de ms en arrancar) → nace ADENTRO del job.
        let reaper = Reaper::arm(pid).expect("armar el Job Object");

        // Leer el pid del nieto de la salida del shell — desde un HILO, con deadline. Un read
        // directo acá se puede colgar PARA SIEMPRE: en ConPTY el read no devuelve EOF si el hijo
        // muere (mismo motivo por el que pty_spawn tiene el hilo waiter), así que un powershell que
        // falle sin imprimir NIETO= dejaría el test binario clavado en vez de rojo.
        let (tx, rx) = channel();
        let mut reader = pty.master.try_clone_reader().unwrap();
        std::thread::spawn(move || {
            let mut buf = [0u8; 256];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        let mut writer = pty.master.take_writer().unwrap();
        let inicio = Instant::now();
        let mut salida = String::new();
        let mut dsr_respondidos = 0;
        let nieto: u32 = loop {
            assert!(
                inicio.elapsed() < Duration::from_secs(20),
                "powershell nunca imprimió NIETO=. Salida cruda:\n{salida}"
            );
            let Ok(chunk) = rx.recv_timeout(Duration::from_secs(20)) else { continue };
            salida.push_str(&String::from_utf8_lossy(&chunk));
            // PowerShell al arrancar consulta dónde está el cursor (DSR, ESC[6n) y BLOQUEA hasta
            // que el terminal conteste. En la app contesta xterm.js; acá el terminal somos nosotros.
            // Se cuenta sobre `salida` (no sobre el chunk) por si la secuencia llega partida en dos.
            while dsr_respondidos < salida.matches("\x1b[6n").count() {
                writer.write_all(b"\x1b[1;1R").unwrap();
                writer.flush().unwrap();
                dsr_respondidos += 1;
            }
            if let Some(resto) = salida.split("NIETO=").nth(1) {
                let digitos: String = resto.chars().take_while(|c| c.is_ascii_digit()).collect();
                // esperamos al \n para saber que el número está completo
                if !digitos.is_empty() && resto.contains('\n') {
                    break digitos.parse().unwrap();
                }
            }
        };

        // Vivo = el proceso abre y su exit code es STILL_ACTIVE (259). El handle se abre y cierra
        // en cada consulta a propósito: un handle abierto retiene el pid y "vivo" mentiría.
        let vivo = |p: u32| unsafe {
            use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
            use windows_sys::Win32::System::Threading::{
                GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            };
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, p);
            if h.is_null() {
                return false;
            }
            let mut code: u32 = 0;
            let ok = GetExitCodeProcess(h, &mut code);
            CloseHandle(h);
            ok != 0 && code == STILL_ACTIVE as u32
        };
        assert!(vivo(nieto), "el nieto tiene que arrancar vivo, si no el test no prueba nada");

        // Lo que hace la app al cerrar el tile: matar al hijo… y después barrer su job.
        child.kill().unwrap();
        let _ = child.wait();
        assert!(vivo(nieto), "sin el Reaper el nieto sobrevive a su padre — si ya murió, este test no distingue nada");
        reaper.reap();

        // TerminateJobObject es síncrono contra el árbol, pero le damos el mismo margen que en unix.
        let murio = (0..40).any(|_| {
            if vivo(nieto) {
                std::thread::sleep(Duration::from_millis(50));
                false
            } else {
                true
            }
        });
        assert!(murio, "el nieto sobrevivió al TerminateJobObject: el job no lo tenía adentro");
    }

    // La razón de existir del coalescing: N chunks que llegan juntos salen en UNA emisión, no en N.
    // Sin esto, varios agentes escupiendo a la vez saturan el IPC y cuelgan el webview.
    #[test]
    fn junta_los_chunks_de_una_rafaga_en_una_sola_emision() {
        let (tx, rx) = channel();
        for c in [b"hola ".as_slice(), b"mundo ", b"pty"] {
            tx.send(c.to_vec()).unwrap();
        }
        drop(tx);

        let mut emisiones: Vec<Vec<u8>> = vec![];
        coalesce(rx, |b| emisiones.push(b));

        assert_eq!(emisiones.len(), 1, "una ráfaga = una emisión, no tres");
        assert_eq!(emisiones[0], b"hola mundo pty");
    }

    // EL fix de batería: en reposo el hilo NO se despierta. Antes hacía recv_timeout(25ms) en loop,
    // o sea 40 despertares por segundo por agente para llamar a un flush vacío.
    #[test]
    fn en_reposo_no_emite_nada_y_no_gira_en_vacio() {
        let (tx, rx) = channel::<Vec<u8>>();
        let t0 = Instant::now();
        let h = std::thread::spawn(move || {
            let mut emisiones = 0;
            coalesce(rx, |_| emisiones += 1);
            emisiones
        });

        std::thread::sleep(Duration::from_millis(300)); // 300ms de silencio: 12 ventanas de 25ms
        tx.send(b"por fin".to_vec()).unwrap();
        drop(tx);

        let emisiones = h.join().unwrap();
        assert_eq!(emisiones, 1, "el silencio no emite: solo el byte real produce una emisión");
        assert!(t0.elapsed() >= Duration::from_millis(300));
    }

    // Una salida enorme no espera la ventana entera: corta al llegar al tope y emite ya.
    #[test]
    fn corta_por_tamano_sin_esperar_la_ventana() {
        let (tx, rx) = channel();
        for _ in 0..5 {
            tx.send(vec![b'x'; 8 * 1024]).unwrap(); // 40KB > TOPE (32KB)
        }
        drop(tx);

        let mut emisiones: Vec<Vec<u8>> = vec![];
        coalesce(rx, |b| emisiones.push(b));

        assert!(emisiones.len() >= 2, "no espera a juntar 40KB: parte en al menos dos emisiones");
        let total: usize = emisiones.iter().map(|e| e.len()).sum();
        assert_eq!(total, 40 * 1024, "y no se pierde un solo byte");
    }
}
