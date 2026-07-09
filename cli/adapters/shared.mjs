// shared.mjs — helpers comunes a todos los adapters.
import { spawn } from "node:child_process";

// Ejecuta un CLI, con stdin cerrado, y devuelve su stdout completo.
// stderr se captura aparte y solo se usa si el proceso falla.
export function spawnCollect(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`No pude ejecutar '${bin}': ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${bin} salió con código ${code}: ${(err || out).slice(0, 800)}`)));
  });
}

// Parser de JSONL tolerante: ignora líneas que no sean JSON (banners, warnings).
export function* jsonlLines(text) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { yield JSON.parse(t); } catch { /* línea no-JSON, la saltamos */ }
  }
}
