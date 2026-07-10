// Comandos de la paleta (⌘K). Interino: se arma desde los stores. La Etapa 2 lo reemplaza por un
// registro de comandos formal (CommandRegistry) que también alimente keybindings y menú nativo.
import type { Command } from "../CommandPalette";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function useCommands(): Command[] {
  const ss = useSessionStore;
  const us = useUiStore;
  return [
    { id: "new-term", label: "Nueva terminal manual", hint: "⌘T", run: () => ss.getState().addTerminal() },
    { id: "close", label: "Cerrar tile activo", hint: "⌘W", run: () => { const a = ss.getState().current()?.activeId; if (a) ss.getState().closeTerminal(a); } },
    { id: "max", label: "Maximizar / restaurar activo", run: () => { const a = ss.getState().current()?.activeId; if (a) ss.getState().toggleMax(a); } },
    { id: "focus-router", label: "Ir al router", run: () => { const r = ss.getState().current()?.routerId; if (r) ss.getState().setActive(r); } },
    { id: "files", label: "Explorador de archivos", run: () => us.getState().openPanel("files") },
    { id: "changes", label: "Cambios (archivos modificados)", run: () => us.getState().openPanel("changes") },
    { id: "browser", label: "Nuevo navegador / preview", run: () => ss.getState().openBrowser() },
    { id: "settings", label: "Configuración", hint: "⌘,", run: () => us.getState().setSettingsOpen(true) },
    { id: "sidebar", label: "Mostrar / ocultar panel", hint: "⌘B", run: () => us.getState().setSidebarOpen((o) => !o) },
    { id: "close-ws", label: "Cerrar este workspace", run: () => { const id = ss.getState().currentId; if (id) ss.getState().closeWorkspace(id); } },
    { id: "workspaces", label: "Panel de workspaces", run: () => us.getState().openPanel("workspaces") },
  ];
}
