// changes.rs — control de cambios de archivos del workspace.
//   watch_workspace/unwatch_workspace: watcher recursivo (notify) que emite "file-changed".
//   git_status/git_diff: estado y diff vía el binario `git` (si el workspace es un repo).
use std::collections::HashMap;
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatchState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>, // 1 watcher por carpeta abierta; drop = stop
}

#[derive(Serialize, Clone)]
struct FileChanged {
    path: String,
    kind: String, // create | modify | remove
    root: String, // la carpeta del workspace (para rutear en el frontend)
}

#[derive(Serialize)]
pub struct GitEntry {
    path: String,   // ruta relativa al repo
    status: String, // código porcelain (M, A, D, ??, ...)
}

#[derive(Serialize)]
pub struct GitDiff {
    old: String,
    new: String,
}

// Rutas ruidosas que no queremos reportar como "cambios".
fn is_ignored(p: &str) -> bool {
    p.contains("/.git/")
        || p.contains("/node_modules/")
        || p.contains("/target/")
        || p.contains("/dist/")
        || p.contains(".hyprdesk")
        || p.ends_with('~')
        || p.ends_with(".swp")
        || p.ends_with(".tmp")
}

// Arranca a vigilar una carpeta (idempotente por carpeta). Emite "file-changed" por cada cambio.
#[tauri::command]
pub fn watch_workspace(app: AppHandle, state: State<'_, WatchState>, folder: String) -> Result<(), String> {
    let mut map = state.watchers.lock().unwrap();
    if map.contains_key(&folder) {
        return Ok(());
    }
    let app2 = app.clone();
    let root = folder.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        let kind = match ev.kind {
            EventKind::Create(_) => "create",
            EventKind::Modify(_) => "modify",
            EventKind::Remove(_) => "remove",
            _ => return,
        };
        for path in ev.paths {
            let p = path.to_string_lossy().to_string();
            if is_ignored(&p) {
                continue;
            }
            let _ = app2.emit("file-changed", FileChanged { path: p, kind: kind.to_string(), root: root.clone() });
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(std::path::Path::new(&folder), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    map.insert(folder, watcher);
    Ok(())
}

// Deja de vigilar (al cerrar el workspace). Drop del watcher = stop.
#[tauri::command]
pub fn unwatch_workspace(state: State<'_, WatchState>, folder: String) {
    state.watchers.lock().unwrap().remove(&folder);
}

// Corre git en `cwd` con el PATH real del usuario. None si no es repo / git falla.
fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("PATH", crate::user_path())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

// Rama git actual del workspace (para el header). None si no es repo.
#[tauri::command]
pub fn git_branch(cwd: String) -> Option<String> {
    let b = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let b = b.trim().to_string();
    if b.is_empty() || b == "HEAD" {
        None
    } else {
        Some(b)
    }
}

// `git status --porcelain` parseado. Vec vacío si no es repo (el front cae al watcher).
#[tauri::command]
pub fn git_status(cwd: String) -> Vec<GitEntry> {
    let Some(out) = git(&cwd, &["status", "--porcelain"]) else {
        return vec![];
    };
    out.lines()
        .filter_map(|l| {
            if l.len() < 4 {
                return None;
            }
            let status = l[..2].trim().to_string();
            let raw = l[3..].trim();
            // renames: "old -> new" → nos quedamos con el destino
            let path = raw.rsplit(" -> ").next().unwrap_or(raw).trim_matches('"').to_string();
            Some(GitEntry { path, status })
        })
        .collect()
}

// Diff de un archivo: viejo = HEAD:<path>, nuevo = contenido actual en disco.
#[tauri::command]
pub fn git_diff(cwd: String, path: String) -> GitDiff {
    let new = std::fs::read_to_string(std::path::Path::new(&cwd).join(&path)).unwrap_or_default();
    let old = git(&cwd, &["show", &format!("HEAD:{path}")]).unwrap_or_default();
    GitDiff { old, new }
}
