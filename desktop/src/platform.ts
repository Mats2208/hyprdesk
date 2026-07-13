// Detección de SO y etiquetas de atajos (para tooltips/kbd de toda la app). En mac glifos compactos
// ("⌘S"); en Windows/Linux texto con "+" ("Ctrl+S"). El binding real lo maneja useKeyboard;
// esto es SOLO presentación. Única fuente de verdad del "¿estamos en mac?" de la app.
export const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl";

// Combina el modificador con una tecla, con el separador correcto por SO. hk("S") → "⌘S" / "Ctrl+S".
export function hk(key: string): string {
  return isMac ? `${MOD}${key}` : `${MOD}+${key}`;
}
