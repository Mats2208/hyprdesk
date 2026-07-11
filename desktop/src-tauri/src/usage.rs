// usage.rs — consumo de tokens de Claude HOY, leyendo los transcripts que claude guarda en
// ~/.claude/projects/**/*.jsonl (cada mensaje del asistente trae message.usage con los tokens).
// Best-effort: cualquier error → 0. (Codex/OpenCode no exponen esto de forma tan limpia todavía.)
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Default)]
pub struct Usage {
    pub tokens: u64,
    pub messages: u64,
}

#[tauri::command]
pub async fn usage_today() -> Usage {
    tauri::async_runtime::spawn_blocking(compute)
        .await
        .unwrap_or_default()
}

// Fecha de HOY en UTC como "YYYY-MM-DD". "" si falla.
fn today_utc() -> String {
    #[cfg(not(windows))]
    {
        // macOS/Linux: `date -u` (comportamiento original, sin crate de fechas).
        std::process::Command::new("date")
            .args(["-u", "+%Y-%m-%d"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(windows)]
    {
        // Windows: `date` es interactivo, así que lo calculamos desde el reloj del sistema.
        // Algoritmo civil de días→(año,mes,día) de Howard Hinnant (dominio público).
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_secs() as i64,
            Err(_) => return String::new(),
        };
        let days = secs.div_euclid(86_400);
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m <= 2 { y + 1 } else { y };
        format!("{:04}-{:02}-{:02}", y, m, d)
    }
}

fn compute() -> Usage {
    // fecha de hoy en UTC (los timestamps del jsonl son ISO "…Z").
    let today = today_utc();
    if today.is_empty() {
        return Usage::default();
    }
    let needle = format!("\"timestamp\":\"{today}");

    let root = crate::home_dir().join(".claude/projects");
    let mut out = Usage::default();
    let now = std::time::SystemTime::now();

    // Recorremos ~/.claude/projects/*/*.jsonl, pero solo abrimos los modificados en las últimas ~36h
    // (los demás no tienen líneas de hoy) para no escanear cientos de MB.
    let Ok(projects) = std::fs::read_dir(&root) else { return out };
    for proj in projects.flatten() {
        let Ok(files) = std::fs::read_dir(proj.path()) else { continue };
        for f in files.flatten() {
            let path = f.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let recent = f
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|mt| now.duration_since(mt).ok())
                .map(|d| d.as_secs() < 36 * 3600)
                .unwrap_or(false);
            if !recent {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else { continue };
            for line in content.lines() {
                if !line.contains(&needle) || !line.contains("\"usage\"") {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                if let Some(u) = v.get("message").and_then(|m| m.get("usage")) {
                    let g = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                    out.tokens += g("input_tokens")
                        + g("output_tokens")
                        + g("cache_creation_input_tokens")
                        + g("cache_read_input_tokens");
                    out.messages += 1;
                }
            }
        }
    }
    out
}
