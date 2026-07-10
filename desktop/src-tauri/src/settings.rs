// settings.rs — configuración global de HyprDesk (~/HyprDesk/settings.json).
// El "asistente" es un CLI headless que la app usa para SUS features de IA (ej. generar perfiles
// de agentes) — NO para escribir código. Usa el login del CLI, sin API keys.
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn default_engine() -> String {
    "claude".into()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Assistant {
    #[serde(default = "default_engine")]
    pub engine: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
}

impl Default for Assistant {
    fn default() -> Self {
        Assistant { engine: default_engine(), model: None, effort: None }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    #[serde(default)]
    pub assistant: Assistant,
}

fn settings_path() -> std::path::PathBuf {
    crate::workspace::root().join("settings.json")
}

#[tauri::command]
pub fn load_settings() -> Settings {
    match std::fs::read_to_string(settings_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    crate::workspace::ensure_root();
    let body = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), body).map_err(|e| e.to_string())
}

// Catálogo de modelos REALES por motor (para que el meta-agente no invente modelos inválidos).
// opencode: los que el usuario tiene autenticados (`opencode models`). claude/codex: los conocidos.
#[derive(Serialize, Default)]
pub struct ModelCatalog {
    pub claude: Vec<String>,
    pub codex: Vec<String>,
    pub opencode: Vec<String>,
}

#[tauri::command]
pub async fn list_models() -> ModelCatalog {
    tauri::async_runtime::spawn_blocking(|| {
        let opencode = std::process::Command::new("opencode")
            .arg("models")
            .env("PATH", crate::user_path())
            .output()
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && s.contains('/'))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        ModelCatalog {
            claude: vec!["opus".into(), "sonnet".into(), "haiku".into()],
            codex: vec!["gpt-5.6-terra".into(), "gpt-5.6-sol".into(), "gpt-5.6".into(), "gpt-5.6-pro".into()],
            opencode,
        }
    })
    .await
    .unwrap_or_default()
}

// Corre el CLI asistente en headless y devuelve el texto de respuesta. Bloqueante (llamada a un
// LLM ~segundos) → va en spawn_blocking para no congelar la UI.
#[tauri::command]
pub async fn run_assistant(prompt: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let a = load_settings().assistant;
        run_cli(&a, &prompt)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run_cli(a: &Assistant, prompt: &str) -> Result<String, String> {
    let (bin, args): (&str, Vec<String>) = match a.engine.as_str() {
        "claude" => {
            let mut v = vec!["-p".into(), prompt.into(), "--output-format".into(), "json".into()];
            if let Some(m) = &a.model {
                v.push("--model".into());
                v.push(m.clone());
            }
            ("claude", v)
        }
        "codex" => {
            let mut v = vec![
                "exec".into(), "--json".into(), "--skip-git-repo-check".into(),
                "--sandbox".into(), "read-only".into(),
            ];
            if let Some(m) = &a.model {
                v.push("-m".into());
                v.push(m.clone());
            }
            if let Some(e) = &a.effort {
                v.push("-c".into());
                v.push(format!("model_reasoning_effort=\"{e}\""));
            }
            v.push(prompt.into());
            ("codex", v)
        }
        "opencode" => {
            let mut v = vec!["run".into(), "--format".into(), "json".into()];
            if let Some(m) = &a.model {
                v.push("-m".into());
                v.push(m.clone());
            }
            v.push(prompt.into());
            ("opencode", v)
        }
        other => return Err(format!("motor asistente desconocido: {other}")),
    };

    let output = std::process::Command::new(bin)
        .args(&args)
        .env("PATH", crate::user_path())
        .output()
        .map_err(|e| format!("no pude correr {bin}: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() && stdout.trim().is_empty() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{bin} falló: {}", err.trim()));
    }
    parse_output(&a.engine, &stdout)
}

// Extrae el texto de la respuesta del formato JSON de cada CLI (ver cli/adapters/*.mjs).
fn parse_output(engine: &str, stdout: &str) -> Result<String, String> {
    match engine {
        "claude" => {
            let v: Value = serde_json::from_str(stdout.trim()).map_err(|e| format!("json claude: {e}"))?;
            Ok(v.get("result").and_then(|r| r.as_str()).unwrap_or("").to_string())
        }
        "codex" => {
            let mut texts = Vec::new();
            for line in stdout.lines() {
                let Ok(ev) = serde_json::from_str::<Value>(line) else { continue };
                if ev.get("type").and_then(|t| t.as_str()) == Some("item.completed") {
                    let item = ev.get("item");
                    if item.and_then(|i| i.get("type")).and_then(|t| t.as_str()) == Some("agent_message") {
                        if let Some(t) = item.and_then(|i| i.get("text")).and_then(|t| t.as_str()) {
                            texts.push(t.to_string());
                        }
                    }
                }
            }
            Ok(texts.join("\n").trim().to_string())
        }
        "opencode" => {
            let mut texts = Vec::new();
            for line in stdout.lines() {
                let Ok(ev) = serde_json::from_str::<Value>(line) else { continue };
                if ev.get("type").and_then(|t| t.as_str()) == Some("text") {
                    let part = ev.get("part");
                    if part.and_then(|p| p.get("type")).and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = part.and_then(|p| p.get("text")).and_then(|t| t.as_str()) {
                            texts.push(t.to_string());
                        }
                    }
                }
            }
            Ok(texts.join("").trim().to_string())
        }
        _ => Ok(stdout.trim().to_string()),
    }
}
