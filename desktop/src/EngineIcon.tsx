// Icono de motor o PROVEEDOR (logo oficial). Los chips de consumo son por PROVEEDOR (dueño de la
// cuota/API key), no por motor: ej. GLM se usa vía OpenCode pero la cuota es de z.ai → logo de z.ai.
// Los assets son cuadrados 1:1 → object-fit contain sin deformar; máscara redondeada + ring sutil
// para que se vean uniformes sobre cualquier fondo (los negros si no se pierden en el chrome oscuro).
import claudeIcon from "./assets/engines/claude.png";
import codexIcon from "./assets/engines/codex.png";
import opencodeIcon from "./assets/engines/opencode.png";
import zaiIcon from "./assets/engines/zai.png";

const ICONS: Record<string, string> = { claude: claudeIcon, codex: codexIcon, opencode: opencodeIcon, glm: zaiIcon };

export function EngineIcon({ engine, size = 16, className }: { engine?: string; size?: number; className?: string }) {
  const src = engine ? ICONS[engine] : undefined;
  if (!src) return null;
  return (
    <img
      src={src} width={size} height={size} alt={engine} title={engine} draggable={false}
      className={`engicon ${className ?? ""}`.trim()}
    />
  );
}
