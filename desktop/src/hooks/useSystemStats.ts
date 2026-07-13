// Pollers presentacionales del titlebar: stats de sistema (2s) y cuotas GLM/Codex/Claude (3min, o al
// tocar un chip vía refreshUsage).
//
// Los DOS se pausan con la ventana oculta (minimizada, o su pestaña de fondo). Son datos que se
// MIRAN: si nadie los mira, cada tick es batería tirada. El de cuotas además spawnea tres procesos
// `curl` — pagarlos con la app minimizada es directamente absurdo.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentUsage, SysStats } from "../types";

// setInterval que solo corre con la ventana visible, y hace un tick al volver (para no mostrar
// un dato viejo el instante en que el usuario vuelve a mirar).
function useVisibleInterval(fn: () => void, ms: number) {
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | undefined;

    const arrancar = () => {
      if (iv !== undefined) return;
      fn();
      iv = setInterval(fn, ms);
    };
    const parar = () => {
      clearInterval(iv);
      iv = undefined;
    };
    const onVis = () => (document.visibilityState === "visible" ? arrancar() : parar());

    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fn, ms]);
}

export function useSystemStats() {
  const [stats, setStats] = useState<SysStats | null>(null);
  const [glm, setGlm] = useState<AgentUsage | null>(null);
  const [codex, setCodex] = useState<AgentUsage | null>(null);
  const [claude, setClaude] = useState<AgentUsage | null>(null);

  const tick = useCallback(() => {
    invoke<SysStats>("system_stats").then(setStats).catch(() => {});
  }, []);
  useVisibleInterval(tick, 2000);

  // Refetch de las cuotas (usado por el poll de 3min y por el clic en un chip).
  const refreshUsage = useCallback(() => {
    invoke<AgentUsage | null>("glm_usage").then(setGlm).catch(() => {});
    invoke<AgentUsage | null>("codex_usage").then(setCodex).catch(() => {});
    invoke<AgentUsage | null>("claude_usage").then(setClaude).catch(() => {});
  }, []);
  useVisibleInterval(refreshUsage, 180000);

  return { stats, glm, codex, claude, refreshUsage };
}
