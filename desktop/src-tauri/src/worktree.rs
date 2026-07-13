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

fn worktrees_dir() -> PathBuf {
    crate::home_dir().join("HyprDesk/.worktrees")
}

fn worktrees_root(ws: &str) -> PathBuf {
    worktrees_dir().join(crate::paths::hash_key(ws))
}

// El hash NO se invierte, así que la carpeta lleva adentro a qué workspace pertenece. Sin esto, al
// recolectar un huérfano no sabríamos en qué repo correr `git worktree prune` y le dejaríamos los
// metadatos podridos. (Mismo criterio que el state file, que lleva su `folder`.)
const WS_MARKER: &str = ".workspace";

// GC de worktrees huérfanos. Una raíz cuyo workspace ya NO está en el índice es basura: el workspace
// se borró, o su carpeta desapareció (list_workspaces poda esos). Se corre al arrancar.
//
// Solo borra raíces ENTERAS de workspaces muertos. Los worktrees de un workspace VIVO no se tocan
// aunque su worker haya muerto: ese trabajo se preserva a propósito (es revisable y mergeable).
pub fn gc_orphans() {
    let Ok(entries) = std::fs::read_dir(worktrees_dir()) else { return };
    let vivos: std::collections::HashSet<String> = crate::workspace::list_workspaces()
        .iter()
        .map(|w| crate::paths::hash_key(&w.folder))
        .collect();

    for e in entries.flatten() {
        let p = e.path();
        let Some(name) = p.file_name().and_then(|n| n.to_str()) else { continue };
        if !p.is_dir() || vivos.contains(name) {
            continue;
        }
        let ws = std::fs::read_to_string(p.join(WS_MARKER)).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&p);
        // El repo puede seguir existiendo (borrar un workspace enlazado NO borra la carpeta del
        // usuario): dejarle metadatos de worktrees que ya no están sería ensuciarle el repo.
        let ws = ws.trim();
        if !ws.is_empty() && std::path::Path::new(ws).is_dir() {
            let _ = git(ws, &["worktree", "prune"]);
        }
    }
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
    let _ = std::fs::write(root.join(WS_MARKER), ws); // a quién pertenece (el hash no se invierte)
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

#[cfg(test)]
mod tests {
    use super::*;

    // El GC tiene que ser QUIRÚRGICO: los worktrees de un workspace vivo se preservan a propósito
    // (aunque su worker haya muerto, ese trabajo es revisable y mergeable). Solo se recolectan las
    // raíces de workspaces que ya no existen — que es lo que se acumulaba para siempre.
    #[test]
    fn recolecta_solo_los_worktrees_de_workspaces_muertos() {
        let _g = crate::workspace::tests::TempHome::new();
        crate::workspace::ensure_root();

        let vivo = crate::workspace::create_workspace("vivo").unwrap();
        let raiz_viva = worktrees_root(&vivo.folder);
        std::fs::create_dir_all(raiz_viva.join("worker-a")).unwrap();

        // Una raíz cuyo workspace no está en el índice: el hash de una carpeta que no existe.
        let raiz_huerfana = worktrees_dir().join(crate::paths::hash_key("C:/borrado/hace/meses"));
        std::fs::create_dir_all(raiz_huerfana.join("worker-b")).unwrap();

        gc_orphans();

        assert!(raiz_viva.join("worker-a").is_dir(), "el trabajo de un workspace VIVO se preserva");
        assert!(!raiz_huerfana.exists(), "la raíz huérfana se recolecta");
    }
}
