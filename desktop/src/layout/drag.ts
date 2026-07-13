// Arrastrar la ventana desde la barra de título.
//
// El CSS usa `-webkit-app-region: drag`, y eso alcanza en Windows... pero NO en macOS. A pesar del
// prefijo, `-webkit-app-region` es una feature de **Chromium**: Windows corre WebView2 (Chromium) y
// la respeta; macOS corre WKWebView (WebKit de Safari) y la **ignora por completo**. Resultado: en
// Mac la barra de título no tenía hitbox — no se podía mover la ventana ni maximizarla.
//
// Solución: pedirle a Tauri que arrastre (`startDragging`), que es nativo en las dos plataformas.
// Solo lo enganchamos en macOS: en Windows el camino de Chromium ya funciona y es más suave (lo
// resuelve el compositor, sin pasar por JS). No arreglamos lo que no está roto.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac } from "../platform";

// Lo que NO arrastra: los controles reales de la barra. Espeja las reglas `no-drag` del CSS.
const INTERACTIVO = "button, input, select, textarea, a, [role='button'], .tmenu, .wctl";

export function dragWindow(e: React.MouseEvent) {
  if (!isMac || e.button !== 0) return;
  if ((e.target as HTMLElement).closest(INTERACTIVO)) return;

  const win = getCurrentWindow();
  // Doble clic = maximizar/restaurar, como cualquier barra de título del sistema.
  if (e.detail === 2) win.toggleMaximize().catch(() => {});
  else win.startDragging().catch(() => {});
}
