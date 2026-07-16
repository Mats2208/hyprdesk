// Definición y registro de todos los comandos de la app. Importar este módulo una vez (App) los registra.
// Los run() leen estado fresco vía getState(), así que no capturan valores viejos.
import { registerCommands } from "./registry";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

const ss = () => useSessionStore.getState();
const us = () => useUiStore.getState();

registerCommands([
  // — Agentes / tiles —
  { id: "new-term", title: "Nueva terminal manual", category: "Agentes", keybinding: "⌘T", run: () => ss().addTerminal() },
  { id: "close-tile", title: "Cerrar tile activo", category: "Agentes", keybinding: "⌘W", run: () => { const a = ss().current()?.activeId; if (a) ss().closeTerminal(a); } },
  { id: "max-tile", title: "Maximizar / restaurar activo", category: "Agentes", run: () => { const a = ss().current()?.activeId; if (a) ss().toggleMax(a); } },
  { id: "new-browser", title: "Nuevo navegador / preview", category: "Agentes", run: () => ss().openBrowser() },

  // — Navegación —
  { id: "focus-router", title: "Ir al router", category: "Navegación", run: () => { const r = ss().current()?.routerId; if (r) ss().setActive(r); } },
  { id: "focus-next", title: "Foco: tile siguiente", category: "Navegación", keybinding: "⌘→", run: () => ss().focusDelta(1) },
  { id: "focus-prev", title: "Foco: tile anterior", category: "Navegación", keybinding: "⌘←", run: () => ss().focusDelta(-1) },

  // — Vista / paneles —
  { id: "panel-agents", title: "Panel de agentes", category: "Vista", run: () => us().openPanel("agents") },
  { id: "panel-files", title: "Panel de archivos", category: "Vista", run: () => us().openPanel("files") },
  { id: "panel-web", title: "Panel web", category: "Vista", run: () => us().openPanel("web") },
  { id: "panel-workspaces", title: "Panel de workspaces", category: "Vista", run: () => us().openPanel("workspaces") },
  { id: "toggle-sidebar", title: "Mostrar / ocultar panel", category: "Vista", keybinding: "⌘B", run: () => us().setSidebarOpen((o) => !o) },
  { id: "toggle-palette", title: "Paleta de comandos", category: "Vista", keybinding: "⌘K", run: () => us().togglePalette() },

  // — Workspace / config —
  { id: "settings", title: "Configuración", category: "Workspace", keybinding: "⌘,", run: () => us().setSettingsOpen(true) },
  { id: "close-ws", title: "Cerrar este workspace", category: "Workspace", run: () => { const id = ss().currentId; if (id) ss().closeWorkspace(id); } },
  { id: "help", title: "Ayuda / bienvenida", category: "Workspace", run: () => us().setWelcomeOpen(true) },
]);
