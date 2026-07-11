// Consumo/cuota de los agentes de SUSCRIPCIÓN (Codex, Claude): leemos el token OAuth que el propio
// CLI ya guardó en disco y le pegamos al endpoint de usage del proveedor — el mismo mecanismo que usa
// el CLI. No se pide API key (a diferencia de GLM): si estás logueado en el CLI, el dato aparece; si
// no, None (y no se muestra chip). Nada sale a terceros: es tu token, tu disco, el API del proveedor.
// Patrón espejo de settings::glm_usage (curl vía hidden_command → sin flash, sin sumar deps).
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Serialize, Default)]
pub struct AgentUsage {
    pub session: Option<f64>, // % USADO del ciclo de 5h
    pub weekly: Option<f64>,  // % USADO semanal
}

fn read_json(path: PathBuf) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

// curl -s GET con headers "K: V"; devuelve el JSON del body o None. 10s de timeout.
fn curl_json(url: &str, headers: &[String]) -> Option<Value> {
    let mut cmd = crate::hidden_command("curl");
    cmd.args(["-s", "--max-time", "10"]);
    for h in headers {
        cmd.arg("-H").arg(h);
    }
    cmd.arg(url);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    serde_json::from_slice(&out.stdout).ok()
}

// ─────────────────────────── Codex (ChatGPT) ───────────────────────────
// Token en $CODEX_HOME/auth.json (o ~/.codex/auth.json) → tokens.access_token + tokens.account_id.
fn codex_auth_path() -> PathBuf {
    if let Ok(h) = std::env::var("CODEX_HOME") {
        if !h.trim().is_empty() {
            return PathBuf::from(h).join("auth.json");
        }
    }
    crate::home_dir().join(".codex").join("auth.json")
}

fn fetch_codex() -> Option<AgentUsage> {
    let auth = read_json(codex_auth_path())?;
    let tokens = auth.get("tokens")?;
    let access = tokens.get("access_token")?.as_str()?;
    let mut headers = vec![
        format!("Authorization: Bearer {access}"),
        "User-Agent: HyprDesk".into(),
        "Accept: application/json".into(),
    ];
    if let Some(acc) = tokens.get("account_id").and_then(Value::as_str) {
        headers.push(format!("ChatGPT-Account-Id: {acc}")); // requerido para team/enterprise
    }
    let v = curl_json("https://chatgpt.com/backend-api/wham/usage", &headers)?;
    let rl = v.get("rate_limit")?;
    let (mut session, mut weekly) = (None, None);
    // Clasificar por duración del window (no asumir el orden): <1 día = ciclo de 5h, ≥1 día = semanal.
    for key in ["primary_window", "secondary_window"] {
        let Some(w) = rl.get(key) else { continue };
        let used = w.get("used_percent").and_then(Value::as_f64);
        let secs = w.get("limit_window_seconds").and_then(Value::as_f64).unwrap_or(0.0);
        if secs > 0.0 && secs < 86_400.0 {
            session = used;
        } else if secs >= 86_400.0 {
            weekly = used;
        }
    }
    if session.is_none() && weekly.is_none() {
        return None;
    }
    Some(AgentUsage { session, weekly })
}

#[tauri::command]
pub async fn codex_usage() -> Option<AgentUsage> {
    tauri::async_runtime::spawn_blocking(fetch_codex).await.ok().flatten()
}

// ─────────────────────────── Claude (Anthropic) ───────────────────────────
// En Windows Claude Code guarda el token en texto en ~/.claude/.credentials.json (el Keychain es
// solo-macOS) → claudeAiOauth.accessToken. El endpoint gatea por anthropic-beta y User-Agent.
fn fetch_claude() -> Option<AgentUsage> {
    let creds = read_json(crate::home_dir().join(".claude").join(".credentials.json"))?;
    let access = creds.get("claudeAiOauth")?.get("accessToken")?.as_str()?;
    let headers = vec![
        format!("Authorization: Bearer {access}"),
        "anthropic-beta: oauth-2025-04-20".into(),
        "User-Agent: claude-code/2.1.0".into(),
        "Accept: application/json".into(),
        "Content-Type: application/json".into(),
    ];
    let v = curl_json("https://api.anthropic.com/api/oauth/usage", &headers)?;
    // utilization = % USADO; la identidad del window viene por el nombre de la key (no hay duración).
    let pct = |k: &str| v.get(k).and_then(|w| w.get("utilization")).and_then(Value::as_f64);
    let (session, weekly) = (pct("five_hour"), pct("seven_day"));
    if session.is_none() && weekly.is_none() {
        return None;
    }
    Some(AgentUsage { session, weekly })
}

#[tauri::command]
pub async fn claude_usage() -> Option<AgentUsage> {
    tauri::async_runtime::spawn_blocking(fetch_claude).await.ok().flatten()
}
