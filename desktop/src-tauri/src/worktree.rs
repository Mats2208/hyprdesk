// worktree.rs — aislamiento de workers en git worktrees. Cada worker (en un workspace git) trabaja
// en su propia rama/worktree para no pisar a los demás; el router luego mergea a la rama principal.
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

pub struct Worktree {
    pub path: String,
    pub branch: String,
}

// Corre git en `cwd` con el PATH real del usuario. None si falla.
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

pub fn is_git_repo(cwd: &str) -> bool {
    git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

fn worktrees_root(ws: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    ws.hash(&mut h);
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("HyprDesk/.worktrees").join(format!("{:016x}", h.finish()))
}

// Crea worktree + rama `hyprdesk/<short>` para el worker si el ws es git. None si no es git o falla.
pub fn create(ws: &str, worker_id: &str) -> Option<Worktree> {
    if !is_git_repo(ws) {
        return None;
    }
    let short = &worker_id[..worker_id.len().min(8)];
    let branch = format!("hyprdesk/{short}");
    let root = worktrees_root(ws);
    let _ = std::fs::create_dir_all(&root);
    let wt = root.join(worker_id);
    let wt_str = wt.to_string_lossy().to_string();
    git(ws, &["worktree", "add", &wt_str, "-b", &branch])?;
    Some(Worktree { path: wt_str, branch })
}

// Elimina el worktree (descarta lo no commiteado). La rama queda (se limpia al mergear).
pub fn remove(ws: &str, path: &str) {
    let _ = git(ws, &["worktree", "remove", "--force", path]);
}

// Commitea lo que haya en el worktree y mergea su rama a la principal del ws.
// Ok(()) si mergeó; Err(conflictos) si hubo conflicto (se aborta el merge).
pub fn merge(ws: &str, worktree_path: &str, branch: &str) -> Result<(), Vec<String>> {
    // 1) commitear WIP del worktree (si hay cambios) — los agentes no commitean solos
    let _ = git(worktree_path, &["add", "-A"]);
    let _ = git(worktree_path, &["commit", "-m", &format!("hyprdesk: merge {branch}")]);
    // 2) mergear la rama a la principal del ws
    if git(ws, &["merge", "--no-ff", "-m", &format!("Merge {branch} (hyprdesk)"), branch]).is_some() {
        return Ok(());
    }
    // 3) conflicto → listar archivos en conflicto y abortar (no dejar el árbol roto)
    let conflicts: Vec<String> = git(ws, &["diff", "--name-only", "--diff-filter=U"])
        .unwrap_or_default()
        .lines()
        .map(|s| s.to_string())
        .collect();
    let _ = git(ws, &["merge", "--abort"]);
    Err(conflicts)
}
