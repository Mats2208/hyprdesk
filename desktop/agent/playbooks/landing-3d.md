Landing / página de producto 3D dirigida por scroll (three.js + GSAP + Lenis): cómo se parte entre workers, qué va primero, y cuál es la compuerta de "listo".

# PLAYBOOK: Landing 3D — scroll-driven, tiempo real

**Esto NO te enseña three.js.** Para eso están las skills de dominio (mirá `list_skills`) y las
skills nativas del motor. Esto te dice **cómo se orquesta** un proyecto así: el corte entre workers,
el contrato que tenés que congelar antes de abrir el abanico, y cómo se verifica.

Sale de un proyecto real (la landing de HyprDesk, 4 workers en paralelo). Las trampas de abajo ya
las pagamos.

## 1. Antes de delegar: ANCLÁ

Preguntale al usuario si tiene un proyecto parecido y **leelo antes de escribir una línea**. Su gusto
ya está codificado en código que shippeó — su stack, sus convenciones, sus decisiones. Un brief
anclado en su propio trabajo le gana a cualquier opinión tuya. Si no hay nada previo, entonces el
stack **es una decisión cara**: `ask_user`.

## 2. El contrato (lo escribís VOS, antes de abrir)

Sin esto, cuatro workers escriben cuatro cosas distintas. Congelá y commiteá:

- **El objeto de estado compartido** (llamalo `S`): la lista EXACTA de props (`camX/Y/Z, rotY, fov,
  bloom, dark, …`) con sus nombres definitivos.
- **La tabla de POSEs**: un nombre de acto por sección, con esas mismas props.
- **La API entre módulos**: qué expone el motor, qué consume el director.
- **Los nombres de los materiales/mallas** del modelo 3D. Esto es lo que permite que el worker de
  escena escriba código contra un modelo que todavía no existe.

## 3. El corte: un dueño por archivo

| worker | posee | skill que carga |
|---|---|---|
| **modelos** | los scripts de generación + los `.glb` | la de modelado 3D procedural |
| **escena** | el MOTOR: crea la escena, expone `S`, renderiza. **No sabe qué es el scroll.** | materiales / luces / postproceso |
| **director** | el DIRECTOR: scroll → `S` → render. Pins, revelado de texto, UI. | scroll / animación |
| **estilo** | los tokens, el layout, el copy | diseño / UI |

Confirmá los nombres de skills con **`list_skills`** — si el playbook nombra una que no existe, se
ignora **en silencio** y el worker arranca desnudo.

**Motor y director son dos archivos y dos dueños.** Es lo que permite que escriban a la vez.

## 4. El camino crítico: los modelos arrancan PRIMERO

Sin `.glb`, escena y director trabajan a ciegas. Lanzá modelos ya, y que los otros dos avancen
**contra un placeholder que respete el contrato** (una caja con el mismo nombre de material). Nadie
espera de brazos cruzados: mientras el 3D se hornea, la página se construye.

## 5. La compuerta: qué significa "listo" acá

No es "compila". Pedí que quede **un harness corrible** que vos puedas correr:

- Cero errores de consola.
- Una **captura por acto**, generada automáticamente (navegador headless con WebGL real).
- **HUD de FPS visible** — el punto es que es tiempo real, no un video.
- Funciona con `prefers-reduced-motion: reduce`: sin animación, **todo el texto legible**.
- Los modelos son **reproducibles**: correr el script los regenera. Nada de assets descargados que
  nadie puede volver a fabricar.

**Y después mirá las capturas vos.** Un harness verde sobre una pantalla fea es un harness verde.
Esa parte no la delegás.

## 6. Trampas ya pagadas (metelas en el brief de cada worker)

- **La cámara se DERIVA del scroll; no se tweenea.** Una función pura `scroll → S`, interpolando la
  tabla de POSEs. Si dejás que varios scrubs escriban `S`, corren carrera y te queda el encuadre de
  un acto con el texto de otro. El scroll debe ser determinista: saltar la barra tiene que dar el
  mismo frame que scrollear hasta ahí.
- **Materiales por NOMBRE, nunca `traverse(o => o.material = x)`.** Eso pinta también la tapa, el
  logo y la sombra.
- **Al optimizar el modelo: comprimir sí, `simplify` NO.** Te faceta los bordes en close-up.
- **El objeto es el héroe.** Si el 3D termina como una viñeta al costado del texto, la premisa no se
  cumplió. Es el error de composición más común, y no lo caza ningún test.
- **Sombra dura sobre un piso invisible = el objeto flota.** O hay piso, o se ilumina como objeto
  suspendido. Elegí.
- **En producción el sitio suele vivir bajo una subruta.** Toda ruta absoluta a un asset (`/models/…`)
  se rompe ahí, y **solo ahí**: el build es verde y la página publicada carga en blanco.
