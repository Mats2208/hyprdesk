// build-agent.mjs — empaqueta el CEREBRO del agente a src-tauri/resources/:
//   · el servidor MCP (+ @modelcontextprotocol/sdk + zod) en UN archivo self-contained, para que
//     corra con `node hyprdesk-mcp.mjs` sin node_modules — igual en dev y en la app empaquetada.
//   · los roles (siempre inyectados en el system prompt del agente)
//   · las skills (dominio, para los workers) y los playbooks (orquestación, para el router)
import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "agent");
const outDir = join(root, "src-tauri", "resources");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(src, "hyprdesk-mcp.mjs")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(outDir, "hyprdesk-mcp.mjs"),
});

for (const f of ["router-role.md", "worker-role.md"]) {
  copyFileSync(join(src, f), join(outDir, f));
}

// cpSync NO poda. Una skill borrada o renombrada sobrevivía para siempre acá: la seguía listando
// `list_skills` y se seguía empaquetando en el instalador. Borramos el destino antes de copiar.
rmSync(join(outDir, "skills"), { recursive: true, force: true });
cpSync(join(src, "skills"), join(outDir, "skills"), { recursive: true });

console.log("[build-agent] MCP + roles + skills → src-tauri/resources/");
