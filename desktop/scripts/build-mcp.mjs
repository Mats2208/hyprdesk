// build-mcp.mjs — empaqueta el MCP hyprdesk (+ @modelcontextprotocol/sdk + zod) en UN solo
// archivo self-contained y copia los roles, todo a src-tauri/resources/. Así el MCP corre con
// `node hyprdesk-mcp.mjs` sin necesitar node_modules — funciona igual en dev y en la app
// empaquetada (Tauri lo shippea como resource), en Windows / macOS / Linux.
import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "src-tauri", "resources");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, "mcp", "hyprdesk-mcp.mjs")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(outDir, "hyprdesk-mcp.mjs"),
});

for (const f of ["router-role.md", "worker-role.md"]) {
  copyFileSync(join(root, "mcp", f), join(outDir, f));
}

// Skills que se inyectan en el rol de los agentes (Ponytail siempre activa, + futuras por dominio).
cpSync(join(root, "mcp", "skills"), join(outDir, "skills"), { recursive: true });

console.log("[build-mcp] MCP bundleado + roles + skills → src-tauri/resources/");
