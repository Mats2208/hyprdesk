// Pollers presentacionales del titlebar: stats de sistema (2s) y cuotas GLM/Codex/Claude (3min, o al
// tocar un chip vía refreshUsage).
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentUsage, SysStats } from "../types";

export function useSystemStats() {
  const [stats, setStats] = useState<SysStats | null>(null);
  const [glm, setGlm] = useState<AgentUsage | null>(null);
  const [codex, setCodex] = useState<AgentUsage | null>(null);
  const [claude, setClaude] = useState<AgentUsage | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const s = await invoke<SysStats>("system_stats"); if (alive) setStats(s); } catch { /**/ }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Refetch de las cuotas (usado por el poll de 3min y por el clic en un chip).
  const refreshUsage = useCallback(() => {
    invoke<AgentUsage | null>("glm_usage").then(setGlm).catch(() => {});
    invoke<AgentUsage | null>("codex_usage").then(setCodex).catch(() => {});
    invoke<AgentUsage | null>("claude_usage").then(setClaude).catch(() => {});
  }, []);

  useEffect(() => {
    refreshUsage();
    const iv = setInterval(refreshUsage, 180000);
    return () => clearInterval(iv);
  }, [refreshUsage]);

  return { stats, glm, codex, claude, refreshUsage };
}
