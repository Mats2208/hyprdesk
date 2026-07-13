// Estado de UI (chrome): paneles, modales, toasts, actividad/estado de tiles, drag del divisor.
// Separado del dominio (sessionStore) para que la UI no arrastre la lógica de sesiones.
import { create } from "zustand";
import type { Panel, TileStatus } from "../types";

// Layout persistido entre sesiones (sidebar abierto + panel activo).
const savedPanel = localStorage.getItem("hd-panel");
// panel izquierdo: "agents" | "workspaces" | "files".
const initPanel: Panel = savedPanel === "workspaces" ? "workspaces" : savedPanel === "files" ? "files" : "agents";

type UiState = {
  sidebarOpen: boolean;
  panel: Panel;
  paletteOpen: boolean;
  settingsOpen: boolean;
  createAgentOpen: boolean;
  teamOpen: boolean;
  toast: string | null;
  askUser: { id: string; question: string } | null;
  activity: string[]; // tiles con mensaje del túnel sin leer (parpadeo)
  statusByTile: Record<string, TileStatus>;
  dragging: boolean;
  wtNoticeDismissed: boolean;
  welcomeOpen: boolean; // onboarding / first-run

  setSidebarOpen: (v: boolean | ((o: boolean) => boolean)) => void;
  openPanel: (p: Panel) => void; // cambia de panel y abre el sidebar
  togglePalette: () => void;
  setPaletteOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setCreateAgentOpen: (v: boolean) => void;
  setTeamOpen: (v: boolean) => void;
  setToast: (t: string | null) => void;
  setAskUser: (q: { id: string; question: string } | null) => void;
  addActivity: (id: string) => void;
  clearActivity: (id: string) => void;
  setStatus: (id: string, st: TileStatus) => void;
  setDragging: (v: boolean) => void;
  dismissWtNotice: () => void;
  setWelcomeOpen: (v: boolean) => void;
  finishOnboarding: () => void; // marca visto + cierra
};

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: localStorage.getItem("hd-sidebar") !== "0",
  panel: initPanel,
  paletteOpen: false,
  settingsOpen: false,
  createAgentOpen: false,
  teamOpen: false,
  toast: null,
  askUser: null,
  activity: [],
  statusByTile: {},
  dragging: false,
  wtNoticeDismissed: localStorage.getItem("hd-wt-notice") === "1",
  welcomeOpen: localStorage.getItem("hd-onboarded") !== "1",

  setSidebarOpen: (v) => set((s) => {
    const sidebarOpen = typeof v === "function" ? v(s.sidebarOpen) : v;
    localStorage.setItem("hd-sidebar", sidebarOpen ? "1" : "0");
    return { sidebarOpen };
  }),
  openPanel: (p) => { localStorage.setItem("hd-panel", p); localStorage.setItem("hd-sidebar", "1"); set({ panel: p, sidebarOpen: true }); },
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setCreateAgentOpen: (v) => set({ createAgentOpen: v }),
  setTeamOpen: (v) => set({ teamOpen: v }),
  setToast: (t) => set({ toast: t }),
  setAskUser: (q) => set({ askUser: q }),
  addActivity: (id) => set((s) => (s.activity.includes(id) ? s : { activity: [...s.activity, id] })),
  clearActivity: (id) => set((s) => (s.activity.includes(id) ? { activity: s.activity.filter((x) => x !== id) } : s)),
  setStatus: (id, st) => set((s) => (s.statusByTile[id] === st ? s : { statusByTile: { ...s.statusByTile, [id]: st } })),
  setDragging: (v) => set({ dragging: v }),
  dismissWtNotice: () => { localStorage.setItem("hd-wt-notice", "1"); set({ wtNoticeDismissed: true }); },
  setWelcomeOpen: (v) => set({ welcomeOpen: v }),
  finishOnboarding: () => { localStorage.setItem("hd-onboarded", "1"); set({ welcomeOpen: false }); },
}));
