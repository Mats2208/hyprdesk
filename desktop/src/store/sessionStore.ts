// Store de dominio: workspaces abiertos (sesiones), tiles/agentes, y todas las acciones que los mutan.
// Con zustand usamos get() para leer estado fresco dentro de las acciones (adiós al juego de refs).
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceMeta } from "./workspaces";
import type { AgentLaunch, Profile, SavedState, Stage, Term, WsSession } from "../types";
import { HOSTS, MAX_TILES, identityOf, savedStateOf, tileFromLaunch } from "./sessionModel";
import { useUiStore } from "./uiStore";

// Revive una sesión guardada: relanza router + workers con --resume, recrea tiles de archivo/navegador.
async function buildRestoredSession(meta: WorkspaceMeta, saved: SavedState): Promise<WsSession> {
  const next: Term[] = [];
  let rId: string | null = null;
  let err: string | null = null;
  let restoreFailed = 0; // workers guardados que no se pudieron resumir (visibilidad al usuario)
  const routerTile = saved.tiles.find((t) => t.role === "router");
  if (routerTile) {
    try {
      const r = await invoke<AgentLaunch>("router_launch", {
        engine: routerTile.engine || "claude", cwd: meta.folder, resumeSession: routerTile.sessionId,
      });
      next.push(tileFromLaunch(r, "router", routerTile.title || `router · ${routerTile.engine}`));
      rId = r.agentId;
    } catch (e) { err = String(e); }
  }
  for (const t of saved.tiles.filter((x) => x.role === "worker" && (!x.kind || x.kind === "terminal") && x.sessionId)) {
    try {
      const w = await invoke<AgentLaunch>("worker_launch", {
        engine: t.engine || "claude", agentId: t.id, sessionId: t.sessionId,
        // R4: restaurar al worker en SU worktree (si tenía) con su rama; ws_root = carpeta del ws.
        cwd: t.cwd || meta.folder, routerId: rId || "router", wsRoot: meta.folder, branch: t.branch || null,
        // Su ROL: sin esto el backend lo revivía con opciones vacías → el worker volvía sin persona
        // ni skills (el --resume le devolvía el historial, no quién era).
        identity: {
          name: t.name, model: t.model, effort: t.effort, persona: t.persona,
          task: t.task, skills: t.skills ?? [], profileId: t.profileId, color: t.color,
        },
      });
      const wt = tileFromLaunch(w, "worker", t.title || `worker · ${t.engine}`);
      wt.name = t.name; wt.color = t.color;
      wt.persona = t.persona; wt.model = t.model; wt.effort = t.effort;
      wt.task = t.task; wt.skills = t.skills; wt.profileId = t.profileId;
      next.push(wt);
    } catch { restoreFailed++; }
  }
  if (restoreFailed > 0) {
    useUiStore.getState().setToast(`⚠️ ${restoreFailed} worker(s) no se pudieron restaurar (sesión no encontrada)`);
  }
  for (const t of saved.tiles.filter((x) => x.kind === "browser")) {
    next.push({ id: t.id, title: t.title, role: "worker", kind: t.kind, url: t.url });
  }
  return {
    meta, terms: next, routerId: rId, activeId: rId || next[0]?.id || "",
    routerWidth: saved.routerWidth || 50, maxId: null, needsRouter: !routerTile, launchError: err,
    profiles: saved.profiles ?? [],
  };
}

type SessionState = {
  stage: Stage;
  sessions: WsSession[];
  currentId: string | null;
  closing: string[];
  previewsByWs: Record<string, string[]>;

  current: () => WsSession | null;
  setStage: (s: Stage) => void;
  setCurrentId: (id: string | null) => void;
  updateSession: (wsId: string, fn: (s: WsSession) => WsSession) => void;
  updateCurrent: (fn: (s: WsSession) => WsSession) => void;

  openWorkspace: (meta: WorkspaceMeta) => Promise<void>;
  closeWorkspace: (wsId: string) => Promise<void>;
  startRouter: (engine: string) => Promise<void>;

  addTerminal: () => void;
  setActive: (id: string) => void;
  openFile: (path: string) => void;
  openBrowser: (url?: string) => void;
  closeTerminal: (id: string) => void;
  toggleMax: (id: string) => void;
  focusDelta: (d: number) => void;
  removeTile: (id: string) => void;

  saveProfile: (p: Profile) => void;
  saveAgentAsProfile: (tileId: string) => void;
  deleteProfile: (id: string) => void;
  mergeWorker: (id: string) => Promise<void>;
  launchProfile: (profile: Profile, task?: string) => Promise<void>;
  launchTeam: (selected: Profile[], goal: string) => Promise<void>;

  restartTile: (id: string) => Promise<void>;
  addWorkerTile: (routerId: string, tile: Term) => void;
  setTileSession: (agentId: string, sessionId: string) => void;
  addPreview: (folder: string, url: string) => void;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  stage: "workspaces",
  sessions: [],
  currentId: null,
  closing: [],
  previewsByWs: {},

  current: () => get().sessions.find((s) => s.meta.id === get().currentId) ?? null,
  setStage: (stage) => set({ stage }),
  setCurrentId: (currentId) => set({ currentId }),
  updateSession: (wsId, fn) => set((st) => ({ sessions: st.sessions.map((s) => (s.meta.id === wsId ? fn(s) : s)) })),
  updateCurrent: (fn) => {
    const id = get().currentId;
    if (id) set((st) => ({ sessions: st.sessions.map((s) => (s.meta.id === id ? fn(s) : s)) }));
  },

  openWorkspace: async (meta) => {
    if (get().sessions.some((s) => s.meta.id === meta.id)) {
      set({ currentId: meta.id, stage: "ide" });
      return;
    }
    // await, no fire-and-forget: touch REESCRIBE el índice y load lo LEE. Dispararlos a la vez era
    // una carrera real que dejaba el índice en [] y abría el workspace vacío (ver workspace.rs).
    await invoke("touch_workspace", { id: meta.id }).catch(() => {});
    let saved: SavedState | null = null;
    try {
      const s = await invoke<string | null>("load_workspace", { folder: meta.folder });
      saved = s ? JSON.parse(s) : null;
    } catch { /* sin estado */ }
    const session: WsSession = (saved && saved.tiles?.length)
      ? await buildRestoredSession(meta, saved)
      : { meta, terms: [], routerId: null, activeId: "", routerWidth: 50, maxId: null, needsRouter: true, launchError: null, profiles: saved?.profiles ?? [] };
    set((st) => ({ sessions: [...st.sessions.filter((s) => s.meta.id !== meta.id), session], currentId: meta.id, stage: "ide" }));
  },

  closeWorkspace: async (wsId) => {
    const s = get().sessions.find((x) => x.meta.id === wsId);
    if (s && !s.needsRouter) {
      await invoke("save_workspace", { folder: s.meta.folder, state: JSON.stringify(savedStateOf(s)) }).catch(() => {});
    }
    const rest = get().sessions.filter((x) => x.meta.id !== wsId);
    const nextCurrent = get().currentId === wsId ? (rest[0]?.meta.id ?? null) : get().currentId;
    set({ sessions: rest, currentId: nextCurrent });
  },

  startRouter: async (engine) => {
    const cur = get().sessions.find((s) => s.meta.id === get().currentId);
    if (!cur) return;
    try {
      const r = await invoke<AgentLaunch>("router_launch", { engine, cwd: cur.meta.folder, resumeSession: null });
      get().updateSession(cur.meta.id, (s) => ({
        ...s, terms: [tileFromLaunch(r, "router", `router · ${engine}`)],
        routerId: r.agentId, activeId: r.agentId, needsRouter: false, launchError: null,
      }));
    } catch (e) {
      get().updateSession(cur.meta.id, (s) => ({ ...s, launchError: String(e) }));
    }
  },

  addTerminal: () => {
    const cwd = get().current()?.meta.folder; // abrir en el workspace, no en el home del usuario
    const t: Term = { id: crypto.randomUUID(), title: HOSTS[Math.floor(Math.random() * HOSTS.length)], role: "worker", cwd };
    get().updateCurrent((s) => (s.terms.length >= MAX_TILES ? s : { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null }));
  },

  setActive: (id) => get().updateCurrent((s) => ({ ...s, activeId: id })),

  openFile: (path) => {
    const name = path.split("/").pop() || path;
    get().updateCurrent((s) => {
      const existing = s.terms.find((t) => t.kind === "file" && t.filePath === path);
      if (existing) return { ...s, activeId: existing.id };
      if (s.terms.length >= MAX_TILES) return s;
      const t: Term = { id: crypto.randomUUID(), title: name, role: "worker", kind: "file", filePath: path };
      return { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null };
    });
  },

  openBrowser: (url) => {
    get().updateCurrent((s) => {
      if (url) {
        const existing = s.terms.find((t) => t.kind === "browser" && t.url === url);
        if (existing) return { ...s, activeId: existing.id };
      }
      if (s.terms.length >= MAX_TILES) return s;
      let title = "navegador";
      try { if (url) title = new URL(url).host || url; } catch { if (url) title = url; }
      const t: Term = { id: crypto.randomUUID(), title, role: "worker", kind: "browser", url };
      return { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null };
    });
  },

  closeTerminal: (id) => {
    const cur = get().current();
    if (!cur) return;
    const t = cur.terms.find((x) => x.id === id);
    if (!t || t.role === "router") return;
    if (t.sessionId || t.name) invoke("unregister_worker", { id }).catch(() => {}); // sacar del roster si era agente
    get().updateCurrent((s) => {
      if (s.activeId !== id) return s;
      const idx = s.terms.findIndex((x) => x.id === id);
      const nextActive = s.terms[idx + 1]?.id ?? s.terms[idx - 1]?.id ?? s.terms[0]?.id ?? "";
      return { ...s, activeId: nextActive };
    });
    set((st) => (st.closing.includes(id) ? st : { closing: [...st.closing, id] }));
  },

  toggleMax: (id) => get().updateCurrent((s) => ({ ...s, maxId: s.maxId === id ? null : id })),

  focusDelta: (d) => {
    const cur = get().current();
    if (!cur) return;
    const idx = cur.terms.findIndex((t) => t.id === cur.activeId);
    if (idx < 0) return;
    get().setActive(cur.terms[(idx + d + cur.terms.length) % cur.terms.length].id);
  },

  removeTile: (id) => set((st) => ({
    sessions: st.sessions.map((s) => ({ ...s, terms: s.terms.filter((t) => t.id !== id), maxId: s.maxId === id ? null : s.maxId })),
    closing: st.closing.filter((x) => x !== id),
  })),

  saveProfile: (profile) => get().updateCurrent((s) => {
    const exists = s.profiles.some((p) => p.id === profile.id);
    const profiles = exists ? s.profiles.map((p) => (p.id === profile.id ? profile : p)) : [...s.profiles, profile];
    return { ...s, profiles };
  }),

  deleteProfile: (id) => get().updateCurrent((s) => ({ ...s, profiles: s.profiles.filter((p) => p.id !== id) })),

  // Un agente que diseñó el router se vuelve un perfil TUYO, reusable. El tile queda VINCULADO al
  // perfil nuevo (profileId): si no, seguiría apareciendo como "del router" y lo verías dos veces.
  saveAgentAsProfile: (tileId) => get().updateCurrent((s) => {
    const t = s.terms.find((x) => x.id === tileId);
    if (!t) return s;
    const profile: Profile = {
      id: crypto.randomUUID(),
      name: t.name || t.title,
      engine: t.engine || "claude",
      model: t.model, effort: t.effort,
      persona: t.persona ?? "",
      color: t.color || "#5f819b",
      skills: t.skills,
    };
    return {
      ...s,
      profiles: [...s.profiles, profile],
      terms: s.terms.map((x) => (x.id === tileId ? { ...x, profileId: profile.id } : x)),
    };
  }),

  mergeWorker: async (id) => {
    const setToast = useUiStore.getState().setToast;
    try {
      const r = await invoke<{ ok: boolean; branch?: string; conflicts?: string[]; error?: string }>("merge_worker", { id });
      if (r.ok) setToast(`✅ Rama ${r.branch} mergeada a la principal`);
      else if (r.conflicts?.length) setToast(`⚠️ Conflicto al mergear ${r.branch}: ${r.conflicts.join(", ")} — se abortó, resolvé a mano`);
      else setToast(r.error || "No se pudo mergear");
    } catch (e) { setToast("Error mergeando: " + String(e)); }
  },

  launchProfile: async (profile, task) => {
    const cur = get().current();
    if (!cur || !cur.routerId) return;
    // La identidad viaja ENTERA al backend y se queda en el tile: así el agente se puede inspeccionar
    // y —sobre todo— revive con su rol cuando se reabre el workspace.
    const identity = { ...identityOf(profile), task: task || undefined };
    try {
      const l = await invoke<AgentLaunch>("spawn_profile_worker", {
        engine: profile.engine, cwd: cur.meta.folder, routerId: cur.routerId, identity,
      });
      // El título lo compone el backend igual para los dos caminos de spawn ("nombre · motor").
      const t = tileFromLaunch(l, "worker", `${profile.name} · ${profile.engine}`);
      t.name = profile.name; t.color = profile.color;
      t.persona = profile.persona; t.model = profile.model; t.effort = profile.effort;
      t.task = task; t.skills = profile.skills; t.profileId = profile.id;
      get().updateCurrent((s) => (s.terms.length >= MAX_TILES ? s : { ...s, terms: [...s.terms, t], activeId: t.id, maxId: null }));
    } catch (e) { useUiStore.getState().setToast(`No pude lanzar "${profile.name}": ${String(e)}`); }
  },

  launchTeam: async (selected, goal) => {
    for (const p of selected) {
      const task = goal
        ? `Sos parte de un equipo. Objetivo compartido: ${goal}\n\nEsperá instrucciones puntuales del router (o del usuario) para tu parte.`
        : undefined;
      await get().launchProfile(p, task);
    }
  },

  // Revive un agente cuyo proceso murió (Ctrl+C, /exit, crash) SIN perder su sesión: lo relanza con
  // --resume de su sessionId. Antes un router muerto te dejaba el workspace inutilizable: había que
  // cerrarlo y reabrirlo. `gen` se incrementa para forzar el remount del tile (= PTY nuevo).
  restartTile: async (id) => {
    const cur = get().current();
    const t = cur?.terms.find((x) => x.id === id);
    if (!cur || !t?.sessionId) return;
    try {
      if (t.role === "router") {
        const r = await invoke<AgentLaunch>("router_launch", {
          engine: t.engine || "claude", cwd: cur.meta.folder, resumeSession: t.sessionId,
        });
        const nt = tileFromLaunch(r, "router", t.title);
        nt.gen = (t.gen ?? 0) + 1;
        get().updateSession(cur.meta.id, (s) => ({
          ...s, terms: s.terms.map((x) => (x.id === id ? nt : x)), routerId: r.agentId, activeId: r.agentId,
        }));
      } else {
        const w = await invoke<AgentLaunch>("worker_launch", {
          engine: t.engine || "claude", agentId: t.id, sessionId: t.sessionId,
          cwd: t.cwd || cur.meta.folder, routerId: cur.routerId || "router",
          wsRoot: cur.meta.folder, branch: t.branch || null,
          identity: identityOf(t), // revive CON su rol, no como un agente genérico
        });
        const nt = tileFromLaunch(w, "worker", t.title);
        nt.name = t.name; nt.color = t.color; nt.gen = (t.gen ?? 0) + 1;
        nt.persona = t.persona; nt.model = t.model; nt.effort = t.effort;
        nt.task = t.task; nt.skills = t.skills; nt.profileId = t.profileId;
        get().updateSession(cur.meta.id, (s) => ({ ...s, terms: s.terms.map((x) => (x.id === id ? nt : x)), activeId: nt.id }));
      }
    } catch (e) {
      useUiStore.getState().setToast(`No pude revivir "${t.title}": ${String(e)}`);
    }
  },

  addWorkerTile: (routerId, tile) => set((st) => ({
    sessions: st.sessions.map((s) => {
      if (s.routerId !== routerId) return s;
      if (s.terms.length >= MAX_TILES) return s;
      return { ...s, terms: [...s.terms, tile], activeId: tile.id, maxId: null };
    }),
  })),

  setTileSession: (agentId, sessionId) => set((st) => ({
    sessions: st.sessions.map((s) => ({ ...s, terms: s.terms.map((t) => (t.id === agentId ? { ...t, sessionId } : t)) })),
  })),

  addPreview: (folder, url) => set((st) => {
    const list = st.previewsByWs[folder] ?? [];
    if (list.includes(url)) return st;
    return { previewsByWs: { ...st.previewsByWs, [folder]: [url, ...list].slice(0, 6) } };
  }),
}));
