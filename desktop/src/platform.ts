// Etiquetas de atajos según el SO (para tooltips/kbd de toda la app). En mac glifos compactos
// ("⌘S"); en Windows/Linux texto con "+" ("Ctrl+S"). El binding real lo maneja useKeyboard;
// esto es SOLO presentación. (comboLabel en commands/keybindings.ts hace lo mismo para los atajos
// remapeables; esto cubre los tooltips fijos.)
export const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";

// Combina el modificador con una tecla, con el separador correcto por SO. hk("S") → "⌘S" / "Ctrl+S".
export function hk(key: string): string {
  return isMac ? `${MOD}${key}` : `${MOD}+${key}`;
}
