// browser.rs — navegador nativo embebido para tiles de tipo "browser" que apuntan a sitios EXTERNOS.
// Un <iframe> no puede cargar sitios con X-Frame-Options (casi toda web en producción); una webview
// nativa sí. Se posiciona como hija de la ventana, sincronizada al rect del tile por el frontend.
// Feature `unstable` de Tauri (multiwebview) — API WIP.
use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Webview, WebviewUrl, Window};

fn find(window: &Window, label: &str) -> Option<Webview> {
    window.webviews().into_iter().find(|w| w.label() == label)
}

fn parse_url(url: &str) -> Result<tauri::Url, String> {
    url.parse::<tauri::Url>().map_err(|e| format!("url inválida: {e}"))
}

// Async por el deadlock conocido al crear webviews desde comandos sync.
#[tauri::command]
pub async fn browser_open(window: Window, label: String, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    if let Some(wv) = find(&window, &label) {
        let _ = wv.close(); // no se pueden duplicar labels
    }
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parse_url(&url)?));
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_bounds(window: Window, label: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    if let Some(wv) = find(&window, &label) {
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_close(window: Window, label: String) -> Result<(), String> {
    if let Some(wv) = find(&window, &label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
