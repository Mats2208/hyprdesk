// Suscripciones a los eventos del backend (túnel/PTYs) → despachan a los stores.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentLaunch } from "../types";
import { tileFromLaunch } from "../store/sessionModel";
import { useSessionStore } from "../store/sessionStore";
import { useUiStore } from "../store/uiStore";

export function useBackendEvents() {
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    (async () => {
      const ss = useSessionStore.getState;
      const us = useUiStore.getState;

      // el router pidió spawnear un worker → lo asignamos a la sesión de ESE router (payload.router).
      unsubs.push(await listen<AgentLaunch & { title: string; router: string; color?: string | null }>("spawn-agent", (e) => {
        const t = tileFromLaunch(e.payload, "worker", e.payload.title);
        if (e.payload.color) t.color = e.payload.color; // color del perfil
        ss().addWorkerTile(e.payload.router, t);
      }));
      // session-id capturado de codex/opencode → completar el tile (para persistir).
      unsubs.push(await listen<{ agentId: string; sessionId: string }>("agent-session", (e) => {
        ss().setTileSession(e.payload.agentId, e.payload.sessionId);
      }));
      // un agente recibió un mensaje del túnel → marcar su tile con actividad (parpadeo).
      unsubs.push(await listen<string>("tile-activity", (e) => us().addActivity(e.payload)));
      // un PTY murió → marcar ese worker como muerto (preserva su worktree) y avisar al router.
      unsubs.push(await listen<string>("pty-exit", (e) => { invoke("unregister_worker", { id: e.payload }).catch(() => {}); }));
      // un mensaje del túnel no se pudo entregar (agente muerto) → avisar al usuario.
      unsubs.push(await listen<string>("tunnel-error", (e) => us().setToast(`⚠️ ${e.payload}`)));
      // el router mergeó una rama de worker → avisar por toast.
      unsubs.push(await listen<{ ok: boolean; branch?: string; conflicts?: string[] }>("merge-result", (e) => {
        const r = e.payload;
        if (r.ok) us().setToast(`✅ El router integró ${r.branch} a la rama principal`);
        else if (r.conflicts?.length) us().setToast(`⚠️ Conflicto al mergear ${r.branch}: ${r.conflicts.join(", ")}`);
      }));
      // el router (ask_user) necesita una decisión del usuario → abrimos el modal (bloquea hasta responder).
      unsubs.push(await listen<{ questionId: string; question: string; router: string }>("ask-user", (e) => {
        us().setAskUser({ id: e.payload.questionId, question: e.payload.question });
      }));
    })();
    return () => unsubs.forEach((u) => u());
  }, []);
}
