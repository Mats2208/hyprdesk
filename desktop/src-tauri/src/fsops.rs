// fsops.rs — operaciones de archivos para los tiles tipo IDE (visor/editor de código).
// Comandos simples sobre std::fs; la app es local/personal, sin sandbox de rutas.
use serde::Serialize;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

// Lee un archivo de texto. Falla si no es UTF-8 válido (binario) → el front muestra el error.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("no pude leer {path}: {e}"))
}

// Escribe (crea/reemplaza) un archivo de texto. Crea los directorios padre si faltan.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| format!("no pude escribir {path}: {e}"))
}

// Lista una carpeta (para abrir archivos sin explorador completo). Dirs primero, luego archivos,
// ambos alfabéticos. Ignora ruido típico (.git, node_modules, target, dist, .hyprdesk*).
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out: Vec<DirEntry> = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| format!("no pude listar {path}: {e}"))?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_noise(&name) {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            path: entry.path().to_string_lossy().to_string(),
            name,
            is_dir,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

pub fn is_noise(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "target" | "dist" | ".DS_Store")
        || name.starts_with(".hyprdesk")
}
