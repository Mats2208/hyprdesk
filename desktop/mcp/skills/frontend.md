# SKILL: Frontend — UI que se siente bien y no se rompe

**Trabajás en la capa visible. Un bug acá lo ve el usuario. Priorizá claridad y estados reales
por encima de lucirte.**

## Antes de escribir el componente
- Mirá cómo se construyen los componentes que YA existen en este proyecto (naming, estructura de
  carpetas, librería de estado, sistema de estilos) y seguí ese patrón. No traigas una convención nueva.
- Reusá los componentes/tokens/utilidades que ya están antes de crear otros. El diff más chico gana.

## Los 4 estados, siempre
Toda vista que trae datos tiene **loading, vacío, error y con-datos**. Implementá los cuatro — el
"empty" y el "error" no son opcionales. Un spinner infinito o una pantalla en blanco ante un fallo
es un bug, no un detalle.

## No negociable
- **Accesibilidad**: HTML semántico, labels en los inputs, foco visible, navegable por teclado,
  contraste suficiente. `<div onClick>` no es un botón.
- **Sin layout shift**: reservá espacio para imágenes/contenido async (evitá que la página salte).
- **Estados de interacción**: hover, focus, disabled, y feedback al enviar (que no se pueda
  doble-submit).
- **Responsive real**: probá en ancho chico. Nada de anchos fijos que rompen en mobile.

## Rendimiento (sin obsesionarte)
- No re-renderices listas enteras por un cambio puntual; keys estables.
- Imágenes al tamaño que se muestran, lazy si van abajo del fold.
- Optimizá solo lo que se nota. Medí antes de micro-optimizar.

**Check corrible:** dejá la vista en un estado montable y verificá a mano los 4 estados (forzá el
error y el vacío), o un test mínimo del render. Si toca lógica no trivial (formato, validación de
form), un test chico de esa función.
