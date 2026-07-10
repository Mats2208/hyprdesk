// memory.rs — memoria del router entre sesiones. El router mantiene un doc conciso por-workspace
// (decisiones, convenciones, plan, qué está hecho/pendiente) que se le RE-INYECTA al rol al reabrir
// el workspace. Se guarda centralizado (no ensucia repos externos) bajo ~/HyprDesk/.memory/<hash>.md.
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

fn memory_path(ws: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    ws.hash(&mut h);
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home)
        .join("HyprDesk/.memory")
        .join(format!("{:016x}.md", h.finish()))
}

// Memoria actual del workspace (None si no hay o está vacía).
pub fn read(ws: &str) -> Option<String> {
    std::fs::read_to_string(memory_path(ws))
        .ok()
        .filter(|s| !s.trim().is_empty())
}

// El router persiste/actualiza su memoria del workspace (sobrescribe el doc completo).
pub fn write(ws: &str, content: &str) -> Result<(), String> {
    let p = memory_path(ws);
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}
