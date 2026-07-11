// Icono del motor (logo oficial). Los tres assets son cuadrados 1:1 → object-fit contain + tamaño
// cuadrado = sin deformar. Máscara de bordes redondeados + ring sutil para que se vean uniformes
// sobre cualquier fondo (el de OpenCode es negro y si no se pierde en el chrome oscuro).
import claudeIcon from "./assets/engines/claude.png";
import codexIcon from "./assets/engines/codex.png";
import opencodeIcon from "./assets/engines/opencode.png";

const ICONS: Record<string, string> = { claude: claudeIcon, codex: codexIcon, opencode: opencodeIcon };

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
