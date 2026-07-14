// workspace.rs — la carpeta raíz ~/HyprDesk, el índice de workspaces y su estado persistido.
//
// Dos reglas de diseño, ambas aprendidas a los golpes (ver git blame):
//
// 1) El ESTADO de un workspace vive SIEMPRE centralizado en ~/HyprDesk/state/<hash(folder)>.json,
//    sea gestionado (carpeta nuestra) o enlazado (carpeta tuya). state_path() es una función PURA
//    de la ruta. Antes decidía dónde guardar preguntándole al índice en caliente: si esa lectura
//    fallaba, un workspace enlazado se trataba como gestionado y su estado se buscaba en un archivo
//    que no existía → el workspace abría VACÍO (router nuevo, agentes perdidos). Un archivo de
//    estado no puede depender de otro archivo para saber dónde vive.
//
// 2) El ÍNDICE es una CACHÉ, no la fuente de verdad. Cada state/*.json lleva adentro su propia
//    `folder`, así que el índice se puede reconstruir solo (recover_index). Y se escribe atómico:
//    fs::write truncaba el archivo, y un lector concurrente veía [] → un read-modify-write lo
//    persistía → índice destruido.
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::paths::{hash_key, normalize, write_atomic};

// Serializa el read-modify-write del índice: sin esto, dos comandos Tauri concurrentes
// (touch_workspace mientras load_workspace lee) se pisan y uno persiste una lista incompleta.
static INDEX_LOCK: Mutex<()> = Mutex::new(());

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceMeta {
    pub id: String,
    pub name: String,
    pub folder: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: u64,
    // gestionado = carpeta creada por nosotros bajo ~/HyprDesk (se puede borrar del disco).
    // enlazado (managed:false) = carpeta externa tuya: NUNCA se borra ni se le escribe adentro.
    #[serde(default = "default_true")]
    pub managed: bool,
}

pub fn root() -> PathBuf {
    crate::home_dir().join("HyprDesk")
}

fn index_path() -> PathBuf {
    root().join("workspaces.json")
}

fn state_dir() -> PathBuf {
    root().join("state")
}

// Dónde vive el estado de un workspace. PURA: solo depende de la ruta. Sin I/O, sin índice.
fn state_path(folder: &str) -> PathBuf {
    state_dir().join(format!("{}.json", hash_key(folder)))
}

pub fn ensure_root() {
    let _ = fs::create_dir_all(root());
    let _ = fs::create_dir_all(state_dir());
    migrate_legacy();
    migrate_verbatim_states(); // ANTES de recover_index: si no, este re-inserta la ruta sucia
    recover_index();
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn mtime_millis(p: &std::path::Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_else(now_millis)
}

fn sanitize(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    if s.is_empty() { "workspace".into() } else { s }
}

// ---- índice ----

// Lee el índice distinguiendo "no hay" (Ok vacío) de "está corrupto" (Err). Esa diferencia es
// justamente la que faltaba: antes un parseo fallido devolvía [] silenciosamente y de ahí se
// escribía [] a disco.
fn read_index() -> Result<Vec<WorkspaceMeta>, String> {
    let raw = match fs::read_to_string(index_path()) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    if raw.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_index(list: &[WorkspaceMeta]) -> Result<(), String> {
    write_atomic(&index_path(), &serde_json::to_string_pretty(list).unwrap_or_default())
}

pub fn list_workspaces() -> Vec<WorkspaceMeta> {
    let _g = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(list) = read_index() else {
        return vec![]; // corrupto → devolvemos vacío pero NO tocamos el disco (recover_index lo arregla)
    };
    // Auto-prune: descartar workspaces cuya carpeta fue borrada a mano. Solo sobre una lectura
    // que parseó bien; nunca persistimos el resultado de una lectura fallida.
    let pruned: Vec<WorkspaceMeta> =
        list.iter().filter(|w| PathBuf::from(&w.folder).is_dir()).cloned().collect();
    if pruned.len() != list.len() {
        let _ = write_index(&pruned);
    }
    pruned
}

// Muta el índice bajo lock (read-modify-write atómico de punta a punta).
fn update_index<T>(f: impl FnOnce(&mut Vec<WorkspaceMeta>) -> Result<T, String>) -> Result<T, String> {
    let _g = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = read_index()?;
    let out = f(&mut list)?;
    write_index(&list)?;
    Ok(out)
}

// ---- estado ----

// El estado se guarda con su `folder` adentro: así el índice es reconstruible y ningún workspace
// se pierde aunque workspaces.json desaparezca.
pub fn save_state(folder: &str, state: &str) -> Result<(), String> {
    let mut v: serde_json::Value = serde_json::from_str(state).map_err(|e| e.to_string())?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert("folder".into(), serde_json::Value::String(folder.to_string()));
    }
    write_atomic(&state_path(folder), &v.to_string())
}

pub fn load_state(folder: &str) -> Option<String> {
    fs::read_to_string(state_path(folder)).ok()
}

// ---- migración y recuperación ----

// Trae al store central el estado de las versiones viejas: el .hyprdesk.json que vivía DENTRO de la
// carpeta (gestionados) y el .linked/<hash>.json (enlazados). Idempotente.
fn migrate_legacy() {
    // 1) enlazados: el nombre del archivo es hash(folder) y el hash no se invierte, así que la
    //    correspondencia hash→folder hay que sacarla del índice mientras todavía exista.
    let linked_root = root().join(".linked");
    if linked_root.is_dir() {
        if let Ok(list) = read_index() {
            for w in list.iter().filter(|w| !w.managed) {
                let old = linked_root.join(format!("{}.json", hash_key(&w.folder)));
                let new = state_path(&w.folder);
                if old.is_file() && !new.exists() {
                    if let Ok(s) = fs::read_to_string(&old) {
                        if save_state(&w.folder, &s).is_ok() {
                            let _ = fs::remove_file(&old);
                        }
                    }
                }
            }
        }
        // si quedó vacía, sacarla (ya no la usamos)
        let _ = fs::remove_dir(&linked_root);
    }

    // 2) gestionados: ~/HyprDesk/<ws>/.hyprdesk.json → state/<hash>.json
    let Ok(rd) = fs::read_dir(root()) else { return };
    for e in rd.flatten() {
        let dir = e.path();
        if !dir.is_dir() || dir.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
            continue;
        }
        let legacy = dir.join(".hyprdesk.json");
        if !legacy.is_file() {
            continue;
        }
        let folder = dir.to_string_lossy().to_string();
        // Si ya hay estado central, solo lo pisamos si el legacy es MÁS NUEVO (puede haberlo escrito
        // una instancia vieja corriendo en paralelo). Descartarlo a ciegas perdía la última sesión.
        let central = state_path(&folder);
        if central.exists() && mtime_millis(&central) >= mtime_millis(&legacy) {
            let _ = fs::remove_file(&legacy);
            continue;
        }
        if let Ok(s) = fs::read_to_string(&legacy) {
            if save_state(&folder, &s).is_ok() {
                let _ = fs::remove_file(&legacy);
            }
        }
    }
}

// Migra los estados guardados con una ruta VERBATIM (\\?\E:\proj) a la ruta limpia.
//
// No alcanza con limpiar el índice, y por eso esto existe: el archivo de estado se LLAMA
// hash(carpeta). Cambiarle la carpeta al workspace sin mover su archivo le borra los tiles, los
// perfiles y los session-ids de un plumazo.
//
// Y hay algo peor, que es lo que de verdad se paga: los WORKTREES de los workers se crean con la
// ruta limpia (el camino del spawn la normaliza), pero el índice guardaba la sucia. Dos hashes para
// la misma carpeta. Entonces `worktree::gc_orphans()` —que al arrancar borra los worktrees que no
// pertenecen a ningún workspace vivo— no reconocía los suyos y los BORRABA, en el proyecto real del
// usuario. Un rm -rf a ciegas por una barra invertida de más.
//
// En Unix es un no-op: strip_verbatim no toca nada y el bucle no encuentra qué migrar.
fn migrate_verbatim_states() {
    let Ok(rd) = fs::read_dir(state_dir()) else { return };
    let archivos: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    for p in archivos {
        let Ok(raw) = fs::read_to_string(&p) else { continue };
        let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
        let Some(sucia) = v["folder"].as_str() else { continue };
        let limpia = crate::paths::strip_verbatim(sucia);
        if limpia == sucia {
            continue;
        }
        let destino = state_path(&limpia);
        if destino.exists() {
            continue; // ya hay estado con la ruta limpia: es el bueno, no lo pisamos
        }
        v["folder"] = serde_json::Value::String(limpia);
        if crate::paths::write_atomic(&destino, &v.to_string()).is_ok() {
            let _ = fs::remove_file(&p); // recién ahora: si el destino no se escribió, no perdemos el original
        }
    }
}

// Reconstruye el índice a partir de los state/*.json (cada uno sabe su carpeta). Recupera
// workspaces que el índice perdió y, de paso, normaliza rutas viejas con prefijo \\?\.
fn recover_index() {
    let _g = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = read_index().unwrap_or_default();
    let before = list.len();

    // sanear lo que ya está: rutas verbatim (\\?\) de versiones viejas.
    let mut changed = false;
    for w in list.iter_mut() {
        let clean = crate::paths::strip_verbatim(&w.folder);
        if clean != w.folder {
            w.folder = clean;
            changed = true;
        }
    }

    let Ok(rd) = fs::read_dir(state_dir()) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().is_none_or(|x| x != "json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&p) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
        let Some(folder) = v["folder"].as_str() else { continue };
        // strip_verbatim ACÁ es el que faltaba, y era el bug: arriba limpiábamos el índice, y dos
        // líneas después volvíamos a meter la ruta SUCIA leída del estado. El saneador se peleaba
        // consigo mismo y el \\?\ sobrevivía a todos los reinicios.
        let folder = crate::paths::strip_verbatim(folder);
        if !PathBuf::from(&folder).is_dir() || list.iter().any(|w| w.folder == folder) {
            continue;
        }
        let name = v["name"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| PathBuf::from(&folder).file_name().map_or("workspace".into(), |n| n.to_string_lossy().into()));
        let id = v["id"].as_str().map(|s| s.to_string()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let managed = PathBuf::from(&folder).starts_with(root());
        list.push(WorkspaceMeta { id, name, folder, last_opened: mtime_millis(&p), managed });
    }

    if changed || list.len() != before {
        let _ = write_index(&list);
    }
}

// ---- comandos ----

pub fn create_workspace(name: &str) -> Result<WorkspaceMeta, String> {
    let _ = fs::create_dir_all(root());
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
        managed: true,
    };
    let m = meta.clone();
    update_index(move |list| {
        list.push(m);
        Ok(())
    })?;
    Ok(meta)
}

// Enlaza una carpeta EXTERNA existente (proyecto real) como workspace: no la crea, no la borra
// nunca, y no le escribe nada adentro.
pub fn link_workspace(folder: &str, name: Option<&str>) -> Result<WorkspaceMeta, String> {
    let p = PathBuf::from(folder);
    if !p.is_dir() {
        return Err("la carpeta no existe".into());
    }
    // normalize() resuelve la ruta SIN dejar el prefijo \\?\ de Windows (ver paths.rs): ese
    // prefijo rompía el --resume de claude y el matcheo de cwd de codex.
    let folder = normalize(folder);
    let name = name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            PathBuf::from(&folder).file_name().map_or("workspace".into(), |n| n.to_string_lossy().into())
        });
    update_index(move |list| {
        if let Some(existing) = list.iter().find(|w| w.folder == folder) {
            return Ok(existing.clone()); // ya enlazada → no duplicar
        }
        let meta = WorkspaceMeta {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            folder,
            last_opened: now_millis(),
            managed: false,
        };
        list.push(meta.clone());
        Ok(meta)
    })
}

// Renombra solo el NOMBRE visible: la carpeta no se toca, porque las sesiones de los agentes están
// indexadas por su ruta (cambiarla rompería el --resume).
pub fn rename_workspace(id: &str, new_name: &str) -> Result<(), String> {
    let name = new_name.trim().to_string();
    update_index(move |list| match list.iter_mut().find(|w| w.id == id) {
        Some(w) => {
            w.name = name;
            Ok(())
        }
        None => Err("workspace no encontrado".into()),
    })
}

// Saca el workspace del índice y borra su estado. Gestionado → también borra su carpeta.
// Enlazado (externo) → NUNCA toca tu carpeta.
pub fn delete_workspace(id: &str) -> Result<(), String> {
    update_index(move |list| {
        if let Some(w) = list.iter().find(|w| w.id == id) {
            let _ = fs::remove_file(state_path(&w.folder));
            if w.managed {
                let _ = fs::remove_dir_all(&w.folder); // best-effort, solo carpetas nuestras
            }
        }
        list.retain(|w| w.id != id);
        Ok(())
    })
}

pub fn touch_workspace(id: &str) {
    let _ = update_index(move |list| {
        if let Some(w) = list.iter_mut().find(|w| w.id == id) {
            w.last_opened = now_millis();
        }
        Ok(())
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests. Cada uno guarda la regresión de un bug que YA pagamos en producción — no hay
// coberturas decorativas acá.
//
// Apuntamos HOME/USERPROFILE a un temp dir: root() deriva de home_dir(), así que los tests
// nunca tocan el ~/HyprDesk real. El env es global al proceso y los tests corren en hilos, así
// que se serializan con un mutex (y el guard restaura el valor original aunque el test paniquee).
#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    static ENV: Mutex<()> = Mutex::new(());

    pub struct TempHome {
        _guard: MutexGuard<'static, ()>,
        prev: Option<String>,
        dir: PathBuf,
    }

    const HOME_VAR: &str = if cfg!(windows) { "USERPROFILE" } else { "HOME" };

    impl TempHome {
        pub fn new() -> Self {
            let guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
            let dir = std::env::temp_dir().join(format!("hyprdesk-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            let prev = std::env::var(HOME_VAR).ok();
            std::env::set_var(HOME_VAR, &dir);
            TempHome { _guard: guard, prev, dir }
        }
        // Una carpeta cualquiera del usuario (fuera de ~/HyprDesk) — el caso "workspace enlazado".
        fn external(&self, name: &str) -> String {
            let p = self.dir.join(name);
            fs::create_dir_all(&p).unwrap();
            p.to_string_lossy().to_string()
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(HOME_VAR, v),
                None => std::env::remove_var(HOME_VAR),
            }
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    // EL bug: el índice del usuario apareció como `[]` con todas las carpetas intactas al lado.
    // Una lectura que falla NO puede persistirse. Nunca.
    #[test]
    fn un_indice_corrupto_no_se_persiste_vacio() {
        let h = TempHome::new();
        ensure_root();
        let ws = create_workspace("proyecto").unwrap();

        fs::write(index_path(), "{ esto no es json }").unwrap();

        // Se lee vacío (degrada), pero el archivo en disco queda INTACTO.
        assert!(list_workspaces().is_empty(), "un índice ilegible se lee como vacío");
        assert_eq!(
            fs::read_to_string(index_path()).unwrap(),
            "{ esto no es json }",
            "PERO no se sobrescribe: el usuario perdería todos sus workspaces"
        );

        // Y un read-modify-write sobre esa lectura fallida tampoco lo pisa.
        touch_workspace(&ws.id);
        assert_eq!(fs::read_to_string(index_path()).unwrap(), "{ esto no es json }");
        drop(h);
    }

    // El índice es una CACHÉ. Cada state file lleva su `folder`, así que se reconstruye solo.
    #[test]
    fn el_indice_se_reconstruye_desde_los_states() {
        let h = TempHome::new();
        ensure_root();
        let a = create_workspace("alpha").unwrap();
        save_state(&a.folder, r#"{"id":"x","name":"alpha","tiles":[]}"#).unwrap();

        fs::remove_file(index_path()).unwrap(); // el índice se pierde entero
        assert!(list_workspaces().is_empty());

        ensure_root(); // dispara recover_index
        let recuperados = list_workspaces();
        assert_eq!(recuperados.len(), 1, "el workspace se recupera desde su state file");
        assert_eq!(recuperados[0].folder, a.folder);
        drop(h);
    }

    // state_path era una función del ÍNDICE. Cuando la lectura fallaba, un workspace enlazado se
    // trataba como gestionado, su estado se buscaba donde no estaba, y abría VACÍO.
    #[test]
    fn el_estado_no_depende_del_indice() {
        let h = TempHome::new();
        ensure_root();
        let externo = h.external("repo-del-usuario");
        let ws = link_workspace(&externo, None).unwrap();
        save_state(&ws.folder, r#"{"id":"y","name":"repo","tiles":[1]}"#).unwrap();

        // Aunque el índice desaparezca, el estado se sigue encontrando: la ruta es pura.
        fs::remove_file(index_path()).unwrap();
        assert!(load_state(&ws.folder).is_some(), "el estado se encuentra sin índice");
        drop(h);
    }

    // Una carpeta EXTERNA es del usuario. Borrar el workspace no puede borrarle el repo.
    #[test]
    fn borrar_un_workspace_enlazado_no_toca_la_carpeta_del_usuario() {
        let h = TempHome::new();
        ensure_root();
        let externo = h.external("mi-repo-importante");
        fs::write(PathBuf::from(&externo).join("codigo.rs"), "fn main() {}").unwrap();
        let ws = link_workspace(&externo, None).unwrap();

        delete_workspace(&ws.id).unwrap();

        assert!(PathBuf::from(&externo).is_dir(), "la carpeta del usuario SIGUE AHÍ");
        assert!(PathBuf::from(&externo).join("codigo.rs").is_file(), "y su código también");
        assert!(list_workspaces().is_empty(), "pero sale del índice");
        drop(h);
    }

    // Y el estado nunca se escribe adentro del repo del usuario.
    #[test]
    fn el_estado_no_ensucia_el_repo_del_usuario() {
        let h = TempHome::new();
        ensure_root();
        let externo = h.external("repo");
        let ws = link_workspace(&externo, None).unwrap();
        save_state(&ws.folder, r#"{"id":"z","name":"repo","tiles":[]}"#).unwrap();

        assert!(!PathBuf::from(&externo).join(".hyprdesk.json").exists(), "nada dentro del repo");
        assert!(state_path(&ws.folder).is_file(), "el estado vive centralizado");
        drop(h);
    }

    // El .hyprdesk.json viejo (que vivía DENTRO de la carpeta) se migra al store central.
    #[test]
    fn migra_el_estado_legacy_y_se_queda_con_el_mas_nuevo() {
        let h = TempHome::new();
        ensure_root();
        let dir = root().join("viejo");
        fs::create_dir_all(&dir).unwrap();
        let folder = dir.to_string_lossy().to_string();
        fs::write(dir.join(".hyprdesk.json"), r#"{"id":"legacy","name":"viejo","tiles":[7]}"#).unwrap();

        ensure_root(); // dispara migrate_legacy

        assert!(!dir.join(".hyprdesk.json").exists(), "el legacy se consume");
        let s = load_state(&folder).expect("el estado migró al store central");
        assert!(s.contains("legacy"), "y conserva el contenido");
        assert_eq!(list_workspaces().len(), 1, "y el workspace aparece en el índice");
        drop(h);
    }

    // El bug que borraba worktrees del proyecto REAL del usuario. Un workspace enlazado quedaba
    // guardado con la ruta verbatim de Windows (\?\E:\proj), pero sus worktrees se creaban con la
    // ruta LIMPIA. Dos hashes para la misma carpeta → gc_orphans no reconocía los worktrees vivos y
    // los recolectaba. Y recover_index no lo arreglaba: limpiaba el índice y en la misma pasada
    // volvía a leer la ruta sucia del estado y la re-insertaba.
    #[cfg(windows)]
    #[test]
    fn una_ruta_verbatim_se_migra_y_no_resucita() {
        let h = TempHome::new();
        ensure_root();
        let proyecto = h.dir.join("PROYECTO-REAL");
        fs::create_dir_all(&proyecto).unwrap();
        let limpia = proyecto.to_string_lossy().to_string();
        let sucia = format!(r"\\?\{limpia}"); // la forma que devuelve canonicalize() en Windows

        // Estado como lo dejaba una versión vieja: archivo nombrado con el hash de la ruta SUCIA.
        let viejo = state_path(&sucia);
        fs::write(&viejo, format!(r#"{{"id":"x","name":"PROYECTO-REAL","folder":{sucia:?},"tiles":[]}}"#)).unwrap();
        write_index(&[WorkspaceMeta {
            id: "x".into(), name: "PROYECTO-REAL".into(), folder: sucia.clone(),
            last_opened: 1, managed: false,
        }]).unwrap();

        ensure_root(); // migra + sanea

        let list = list_workspaces();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].folder, limpia, "el índice quedó con la ruta limpia");
        assert!(!viejo.exists(), "el estado viejo se movió, no quedó duplicado");
        assert!(state_path(&limpia).exists(), "el estado vive bajo el hash de la ruta LIMPIA");
        assert!(load_state(&limpia).is_some(), "y se puede leer: no se perdieron tiles ni perfiles");

        // La prueba de fuego: reabrir la app NO puede resucitar la ruta sucia desde el estado.
        ensure_root();
        assert_eq!(list_workspaces()[0].folder, limpia, "la ruta verbatim no resucita al reiniciar");
    }
}
