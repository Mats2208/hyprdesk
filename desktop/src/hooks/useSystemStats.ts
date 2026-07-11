// Pollers presentacionales del titlebar: stats de sistema (2s) y cuotas GLM/Codex/Claude (3min).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentUsage, GlmUsage, SysStats } from "../types";

export function useSystemStats() {
  const [stats, setStats] = useState<SysStats | null>(null);
  const [glm, setGlm] = useState<GlmUsage | null>(null);
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

  useEffect(() => {
    let alive = true;
    const tick = () => {
      invoke<GlmUsage | null>("glm_usage").then((g) => { if (alive) setGlm(g); }).catch(() => {});
      invoke<AgentUsage | null>("codex_usage").then((c) => { if (alive) setCodex(c); }).catch(() => {});
      invoke<AgentUsage | null>("claude_usage").then((c) => { if (alive) setClaude(c); }).catch(() => {});
    };
    tick();
    const iv = setInterval(tick, 180000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return { stats, glm, codex, claude };
}
