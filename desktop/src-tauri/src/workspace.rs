// workspace.rs — manejo de la carpeta raíz ~/HyprDesk y los workspaces.
// Cada workspace = una subcarpeta (donde trabajan los agentes) + un .hyprdesk.json
// con su estado (tiles/layout/sessionIds, cuyo formato maneja el frontend).
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceMeta {
    pub id: String,
    pub name: String,
    pub folder: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: u64,
}

pub fn root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("HyprDesk")
}

pub fn ensure_root() {
    let _ = fs::create_dir_all(root());
}

fn index_path() -> PathBuf {
    root().join("workspaces.json")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sanitize(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    if s.is_empty() { "workspace".into() } else { s }
}

pub fn list_workspaces() -> Vec<WorkspaceMeta> {
    let list: Vec<WorkspaceMeta> = match fs::read_to_string(index_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => vec![],
    };
    // Auto-prune: descartar workspaces cuya carpeta fue borrada a mano.
    let pruned: Vec<WorkspaceMeta> = list
        .iter()
        .filter(|w| std::path::Path::new(&w.folder).is_dir())
        .cloned()
        .collect();
    if pruned.len() != list.len() {
        let _ = write_index(&pruned); // persistir el índice depurado
    }
    pruned
}

fn write_index(list: &[WorkspaceMeta]) -> Result<(), String> {
    ensure_root();
    fs::write(index_path(), serde_json::to_string_pretty(list).unwrap_or_default())
        .map_err(|e| e.to_string())
}

pub fn create_workspace(name: &str) -> Result<WorkspaceMeta, String> {
    ensure_root();
    let base = sanitize(name);
    let mut folder = root().join(&base);
    let mut i = 2;
    while folder.exists() {
        folder = root().join(format!("{base}-{i}"));
        i += 1;
    }
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let meta = WorkspaceMeta {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        folder: folder.to_string_lossy().to_string(),
        last_opened: now_millis(),
    };
    let mut list = list_workspaces();
    list.push(meta.clone());
    write_index(&list)?;
    Ok(meta)
}

// Renombra solo el NOMBRE visible (la carpeta se mantiene, para no romper las sesiones
// de los agentes que están indexadas por su ruta/cwd).
pub fn rename_workspace(id: &str, new_name: &str) -> Result<(), String> {
    let mut list = list_workspaces();
    let mut found = false;
    for w in list.iter_mut() {
        if w.id == id {
            w.name = new_name.trim().to_string();
            found = true;
        }
    }
    if !found {
        return Err("workspace no encontrado".into());
    }
    write_index(&list)
}

// Elimina el workspace: borra su carpeta y su entrada del índice.
pub fn delete_workspace(id: &str) -> Result<(), String> {
    let list = list_workspaces();
    if let Some(w) = list.iter().find(|w| w.id == id) {
        let _ = fs::remove_dir_all(&w.folder); // best-effort
    }
    let kept: Vec<WorkspaceMeta> = list.into_iter().filter(|w| w.id != id).collect();
    write_index(&kept)
}

pub fn touch_workspace(id: &str) {
    let mut list = list_workspaces();
    for w in list.iter_mut() {
        if w.id == id {
            w.last_opened = now_millis();
        }
    }
    let _ = write_index(&list);
}

pub fn load_state(folder: &str) -> Option<String> {
    fs::read_to_string(PathBuf::from(folder).join(".hyprdesk.json")).ok()
}

pub fn save_state(folder: &str, state: &str) -> Result<(), String> {
    fs::write(PathBuf::from(folder).join(".hyprdesk.json"), state).map_err(|e| e.to_string())
}
