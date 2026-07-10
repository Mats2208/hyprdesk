// Efectos "de pegamento" que antes vivían sueltos en App.tsx: autosave, registro de perfiles en el hub,
// cwd activo, auto-cierre del toast, animación de cierre de tiles, y fallbacks de stage/tile activo.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { savedStateOf } from "../store/sessionModel";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function useAppEffects() {
  const sessions = useSessionStore((s) => s.sessions);
  const currentId = useSessionStore((s) => s.currentId);
  const stage = useSessionStore((s) => s.stage);
  const closing = useSessionStore((s) => s.closing);
  const toast = useUiStore((s) => s.toast);

  // Registrar los perfiles de cada workspace en el hub bajo el id de SU router (H1).
  useEffect(() => {
    for (const s of sessions) {
      if (!s.routerId) continue;
      invoke("register_profiles", {
        routerId: s.routerId,
        profiles: s.profiles.map((p) => ({
          id: p.id, name: p.name, engine: p.engine, model: p.model ?? null,
          effort: p.effort ?? null, persona: p.persona, color: p.color ?? null,
        })),
      }).catch(() => {});
    }
  }, [sessions]);

  // cwd "activo" del backend apuntando al workspace visible (fallback del túnel).
  useEffect(() => {
    const cur = useSessionStore.getState().current();
    if (cur) invoke("set_active_workspace", { folder: cur.meta.folder }).catch(() => {});
  }, [currentId]);

  // auto-guardar el estado de cada sesión (debounce).
  useEffect(() => {
    if (stage !== "ide") return;
    const t = setTimeout(() => {
      for (const s of useSessionStore.getState().sessions) {
        if (s.needsRouter) continue;
        invoke("save_workspace", { folder: s.meta.folder, state: JSON.stringify(savedStateOf(s)) }).catch(() => {});
      }
    }, 500);
    return () => clearTimeout(t);
  }, [sessions, stage]);

  // si se cerró la última sesión, volver al gestor full-screen.
  useEffect(() => {
    if (stage === "ide" && sessions.length === 0) useSessionStore.getState().setStage("workspaces");
  }, [sessions, stage]);

  // si el tile activo desapareció, caer al router de esa sesión.
  useEffect(() => {
    const cur = useSessionStore.getState().current();
    if (!cur) return;
    if (cur.routerId && !cur.terms.find((t) => t.id === cur.activeId)) {
      useSessionStore.getState().updateSession(cur.meta.id, (s) => ({ ...s, activeId: s.routerId || s.terms[0]?.id || "" }));
    }
  }, [sessions, currentId]);

  // limpiar la actividad del tile que se enfoca.
  useEffect(() => {
    const activeId = useSessionStore.getState().current()?.activeId;
    if (activeId) useUiStore.getState().clearActivity(activeId);
  }, [sessions, currentId]);

  // auto-cerrar el toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useUiStore.getState().setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // animar el cierre y luego remover el tile.
  useEffect(() => {
    if (closing.length === 0) return;
    const timers = closing.map((id) => setTimeout(() => useSessionStore.getState().removeTile(id), 200));
    return () => timers.forEach(clearTimeout);
  }, [closing]);
}
