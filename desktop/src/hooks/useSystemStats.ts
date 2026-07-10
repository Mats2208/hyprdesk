// Pollers presentacionales del titlebar: stats de sistema (2s) y cuota GLM/z.ai (3min).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GlmUsage, SysStats } from "../types";

export function useSystemStats() {
  const [stats, setStats] = useState<SysStats | null>(null);
  const [glm, setGlm] = useState<GlmUsage | null>(null);

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
    const tick = () => invoke<GlmUsage | null>("glm_usage").then((g) => { if (alive) setGlm(g); }).catch(() => {});
    tick();
    const iv = setInterval(tick, 180000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return { stats, glm };
}
