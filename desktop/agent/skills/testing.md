# SKILL: Testing / QA — tests que atrapan bugs, no que inflan el número

**Un test existe para fallar cuando el código se rompe. Un test que nunca puede fallar es ruido.
Cubrí el comportamiento que importa, no líneas por cubrir.**

## Antes de escribir tests
- Usá el framework y las convenciones que YA tiene el proyecto (dónde viven, cómo se nombran, cómo
  se corren). No traigas otro runner.
- Entendé qué hace la unidad bajo test siguiendo su flujo real. Testear a ciegas produce tests que
  afirman lo que el código hace, no lo que DEBERÍA hacer.

## Qué cubrir (en orden)
1. **Camino feliz** de la lógica no trivial.
2. **Edge cases**: vacío, null, cero, límites, listas de 1 elemento, unicode, negativos.
3. **Errores**: input inválido → ¿falla como se espera (excepción/código correcto), sin corromper estado?
4. **Regresión**: cuando arreglás un bug, dejá un test que lo reproduce (que fallaba antes del fix).

## Reglas
- **Un test por comportamiento**, con nombre que dice qué verifica. Que al fallar te diga qué se rompió.
- **Determinista**: nada de depender de reloj real, red, orden de ejecución o aleatoriedad sin fijar
  semilla. Un test flaky es peor que ningún test — erosiona la confianza en toda la suite.
- **Assert del resultado, no del ruido**: verificá el efecto observable, no detalles internos que
  cambian sin romper nada.
- **Testeá contra el contrato**, no reimplementes la lógica en el test (si copiás el algoritmo, el
  test pasa aunque ambos estén mal).
- Cubrí lo que puede romperse. No escribas tests triviales de getters para subir el %.

## Al terminar
Corré la suite y confirmá que **pasa en verde**. Si escribiste un test de regresión, verificá que
falla sin el fix (si podés) — así sabés que realmente prueba algo.
