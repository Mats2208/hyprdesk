// Proveedores/API keys definidos por el usuario (por ahora solo se guardan local — el consumo por los
// agentes es una etapa de backend futura). Persistidos en localStorage.
export type Provider = { id: string; label: string; key: string };

const K = "hd-providers";

export function loadProviders(): Provider[] {
  try { const v = JSON.parse(localStorage.getItem(K) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export function saveProviders(list: Provider[]) {
  localStorage.setItem(K, JSON.stringify(list));
}
