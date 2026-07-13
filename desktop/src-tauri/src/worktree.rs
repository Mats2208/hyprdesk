// worktree.rs — aislamiento de workers en git worktrees. Cada worker (en un workspace git) trabaja
// en su propia rama/worktree para no pisar a los demás; el router luego mergea a la rama principal.
use std::path::PathBuf;

pub struct Worktree {
    pub path: String,
    pub branch: String,
}

// Corre git en `cwd` con el PATH real del usuario. None si falla. Único wrapper de git de la app
// (engines.rs tenía su propia copia SIN el PATH → no encontraba git al lanzarse desde el Finder).
pub fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = crate::hidden_command("git")
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
    crate::home_dir().join("HyprDesk/.worktrees").join(crate::paths::hash_key(ws))
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

// Commitea el WIP del worktree (los agentes no commitean solos) para que el diff lo incluya.
// Idempotente: si no hay cambios el commit falla sin efecto. Devuelve el rango base..branch.
fn commit_wip_and_range(ws: &str, worktree_path: &str, branch: &str) -> Option<String> {
    let _ = git(worktree_path, &["add", "-A"]);
    let _ = git(worktree_path, &["commit", "-m", &format!("hyprdesk: review {branch}")]);
    let base = git(ws, &["merge-base", "HEAD", branch]).map(|s| s.trim().to_string())?;
    Some(format!("{base}..{branch}"))
}

// Recorta `s` a ~`max` bytes en un límite de char, con nota de que se cortó.
fn cap(mut s: String, max: usize, note: &str) -> String {
    if s.len() > max {
        let cut = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(max);
        s.truncate(cut);
        s.push_str(note);
    }
    s
}

// Revisión BARATA (C2): commitea el WIP y devuelve (resumen --stat, diff-inline). El --stat lista
// los archivos cambiados (barato). El diff completo va inline SOLO si es chico (≤ INLINE); si es
// grande, diff = "" y el router pide archivos puntuales con review_file → no revienta su contexto.
// None si no es git o falla.
pub fn review(ws: &str, worktree_path: &str, branch: &str) -> Option<(String, String)> {
    let range = commit_wip_and_range(ws, worktree_path, branch)?;
    let stat = git(ws, &["diff", "--stat", &range]).unwrap_or_default();
    let diff = git(ws, &["diff", &range]).unwrap_or_default();
    const INLINE: usize = 6_000; // diffs chicos van inline; los grandes se piden por archivo
    let diff = if diff.len() <= INLINE { diff } else { String::new() };
    Some((stat, diff))
}

// Review on-demand (C2): diff de UN archivo de la rama del worker vs la principal. El router lo
// llama tras ver el --stat, para inspeccionar archivos puntuales sin volcar todo el diff.
// Se recorta a ~40KB como red de seguridad (un solo archivo enorme). None si no es git o falla.
pub fn review_file(ws: &str, worktree_path: &str, branch: &str, file: &str) -> Option<String> {
    let range = commit_wip_and_range(ws, worktree_path, branch)?;
    let diff = git(ws, &["diff", &range, "--", file]).unwrap_or_default();
    Some(cap(diff, 40_000, "\n\n… (archivo recortado — es enorme; revisalo con shell si necesitás el resto)"))
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
