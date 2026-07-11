# SKILL: Backend — datos correctos, límites defendidos

**Sos el guardián de los datos y los contratos. Un error acá corrompe estado o filtra info.
Correcto y defensivo antes que ingenioso.**

## Antes de escribir el endpoint/servicio
- Seguí los patrones que YA existen en el proyecto: capas (handler/servicio/repo), manejo de
  errores, validación, logging, cómo se accede a la DB. No inventes una arquitectura paralela.
- Reusá los helpers/middlewares/validadores existentes.

## En cada límite de confianza (input externo)
- **Validá el input** apenas entra: tipos, rangos, requeridos, formato. No confíes en el cliente.
- **Parametrizá** toda query (nunca concatenes SQL/consultas con input) → inyección.
- **Autorizá** además de autenticar: ¿este usuario puede tocar ESTE recurso? No alcanza con estar logueado.
- No devuelvas más de lo necesario (evitá filtrar campos internos/secretos en la respuesta).

## Errores y consistencia
- Manejá los errores para que **no haya pérdida ni corrupción de datos**. Si una operación tiene
  varios pasos que deben ser atómicos, usá transacción; si falla, revertí.
- Códigos de estado y mensajes de error correctos (4xx del cliente vs 5xx del servidor). No tragues
  excepciones en silencio.
- Pensá idempotencia y condiciones de carrera en lo que se puede reintentar o correr en paralelo.

## Antes de dar por terminado
- ¿Migración/cambio de esquema? Que sea compatible hacia atrás o esté versionada.
- No hardcodees secretos: variables de entorno / config.

**Check corrible:** un test mínimo del camino feliz **y** de un input inválido (que devuelva el
error esperado, no un 500). Sin frameworks pesados si el proyecto no los usa: la cosa más chica que
falla si la lógica se rompe.
