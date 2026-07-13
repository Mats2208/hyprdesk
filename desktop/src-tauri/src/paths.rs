// paths.rs — helpers de rutas compartidos: clave de hash, normalización y escritura atómica.
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

// Clave estable (16 hex) derivada de una ruta. DefaultHasher es determinista entre corridas
// (SipHash con claves fijas), así que la misma carpeta siempre da el mismo archivo.
pub fn hash_key(s: &str) -> String {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

// Saca el prefijo "verbatim" de Windows (\\?\C:\x → C:\x, \\?\UNC\srv\s → \\srv\s).
//
// CLAVE: fs::canonicalize en Windows devuelve SIEMPRE la forma extendida (\\?\E:\proj). Esa
// forma es válida para el SO pero venenosa para todo lookup por string, porque nadie más la usa:
// Windows le pasa al proceso hijo el cwd ya normalizado, así que claude (vía Node) escribe su
// transcript en ~/.claude/projects/E--proj mientras nosotros lo buscábamos en --?-E--proj → el
// --resume fallaba en silencio y el agente arrancaba sin memoria.
pub fn strip_verbatim(p: &str) -> String {
    #[cfg(windows)]
    {
        if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = p.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    p.to_string()
}

// Ruta absoluta y normalizada: resuelve symlinks/relativos y deja la forma que usa el resto del
// mundo. Si la ruta no existe, devuelve la original (no inventamos).
pub fn normalize(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| strip_verbatim(&p.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string())
}

// Escritura ATÓMICA: escribe a un .tmp y renombra. Un lector concurrente ve el archivo viejo
// ENTERO o el nuevo ENTERO, nunca uno truncado a medias. fs::write hace truncate+write, y esa
// ventana de "archivo vacío" era lo que dejaba el índice de workspaces en [] (pérdida de datos).
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    // En Windows fs::rename reemplaza el destino (MOVEFILE_REPLACE_EXISTING), igual que en Unix.
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // El bug: canonicalize() en Windows devuelve la forma verbatim, y ese prefijo rompía TODO lookup
    // por string — claude escribe su transcript en E--proj y nosotros lo buscábamos en --?-E--proj.
    #[test]
    #[cfg(windows)]
    fn saca_el_prefijo_verbatim_de_windows() {
        let verbatim = concat!(r"\\", r"?\", r"E:\PROYECTOS\hyprdesk");
        assert_eq!(strip_verbatim(verbatim), r"E:\PROYECTOS\hyprdesk");

        let unc = concat!(r"\\", r"?\UNC\servidor\share");
        assert_eq!(strip_verbatim(unc), r"\\servidor\share");

        assert_eq!(strip_verbatim(r"C:\normal\path"), r"C:\normal\path", "una ruta normal no se toca");
    }

    // La clave del state file. Si no fuera estable entre corridas, cada reinicio perdería el estado.
    #[test]
    fn el_hash_es_estable_y_distingue() {
        assert_eq!(hash_key("C:/a/b"), hash_key("C:/a/b"), "misma ruta → misma clave, siempre");
        assert_ne!(hash_key("C:/a/b"), hash_key("C:/a/c"));
        assert_eq!(hash_key("x").len(), 16);
    }

    // fs::write trunca: un lector concurrente veía el archivo vacío, lo parseaba como [] y ese []
    // volvía a disco. Escribir a un temp y renombrar hace la operación indivisible.
    #[test]
    fn la_escritura_atomica_reemplaza_y_no_deja_basura() {
        let dir = std::env::temp_dir().join(format!("hd-atomic-{}", uuid::Uuid::new_v4()));
        let f = dir.join("sub").join("x.json");

        write_atomic(&f, "primero").unwrap(); // crea los padres que falten
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "primero");

        write_atomic(&f, "segundo").unwrap(); // reemplaza (en Windows también)
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "segundo");

        let sobrantes: Vec<_> = std::fs::read_dir(f.parent().unwrap()).unwrap().flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "tmp")).collect();
        assert!(sobrantes.is_empty(), "el .tmp no queda colgado");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
