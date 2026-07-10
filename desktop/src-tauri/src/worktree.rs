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

// Revisión: qué hizo el worker en su rama vs la principal (para que el router critique antes de mergear).
// Commitea el WIP del worktree (para que el diff lo incluya) y devuelve (resumen --stat, diff completo).
// El diff se recorta a ~60KB para no reventar el contexto del router. None si no es git o falla.
pub fn review(ws: &str, worktree_path: &str, branch: &str) -> Option<(String, String)> {
    // 1) commitear WIP del worktree (los agentes no commitean solos) → el diff incluye todo
    let _ = git(worktree_path, &["add", "-A"]);
    let _ = git(worktree_path, &["commit", "-m", &format!("hyprdesk: review {branch}")]);
    // 2) base = ancestro común entre la principal (HEAD del ws) y la rama del worker
    let base = git(ws, &["merge-base", "HEAD", branch]).map(|s| s.trim().to_string())?;
    let range = format!("{base}..{branch}");
    let stat = git(ws, &["diff", "--stat", &range]).unwrap_or_default();
    let mut diff = git(ws, &["diff", &range]).unwrap_or_default();
    const MAX: usize = 60_000;
    if diff.len() > MAX {
        let cut = diff.char_indices().nth(MAX).map(|(i, _)| i).unwrap_or(MAX);
        diff.truncate(cut);
        diff.push_str("\n\n… (diff recortado — pedí archivos puntuales al worker o revisalos con shell)");
    }
    Some((stat, diff))
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
