# Issue #8 — Endpoint de salud y prueba de salud local (diseño)

**Aprobado por el responsable en la conversación (2026-11-22).** Tamaño: cambio pequeño (un endpoint, una prueba de integración, un script y documentación).

## Intención
Que cualquier integrante pueda instalar el proyecto y ejecutar una **prueba de salud local** automatizada: es parte del criterio de salida de H0 (`docs/01-producto/02-roadmap.md`). Criterio de aceptación de la issue: es la prueba de salud local que exige el criterio de salida de H0.

## Metas
- `GET /api/health` sin efectos secundarios, sin exponer secretos ni versiones internas.
- Prueba automatizada contra la **app real** (no el fixture) que valida la respuesta y falla si la configuración es inválida.
- Script `test:health` autocontenido.
- Primera cobertura automatizada de `scripts/start.ts` (en la issue #4 solo se verificó a mano).

## No metas
Comprobación de base de datos (aún no existe), endpoint de *readiness*, métricas, versión de la aplicación, cambios al middleware o a los errores tipados, ADR (no cambia ninguna regla confirmada).

## Anti-metas
Exponer cualquier dato de configuración o de versión; que la salud responda "ok" con configuración inválida; una prueba que dependa de `.env`, de una base de datos o de un servicio externo.

## Hechos verificados
- El servidor real no envía `Server` ni `X-Powered-By` (cabeceras medidas: `content-type`, `Date`, `Connection`, `Keep-Alive`, `Transfer-Encoding`).
- Un `POST` a un endpoint que solo define `GET` responde `404` en HTML (no `405`); `HEAD` responde `200` con las mismas cabeceras.
- `src/middleware.ts` llama a `getConfig()` en cada petición y convierte los errores de `/api/` con `toErrorResponse` (ADR-019): con configuración inválida, `/api/health` responde `500 internal_error`, nunca "ok".
- `scripts/start.ts` valida y sale con código 1 antes de escuchar (verificado a mano en la issue #4).

## Decisiones tomadas
- Respuesta: `200` con `{ "status": "ok" }` y `Cache-Control: no-store`; no lee configuración, versiones ni base de datos. Que responda "ok" implica que el servidor arrancó con configuración válida.
- Ruta `/api/health` (la que fija la issue; los endpoints de negocio siguen bajo `/api/v1/`).
- Prueba en `tests/integration/health.test.ts`: construye el proyecto raíz con `astro build` y un entorno válido explícito (sin `.env`; el entorno explícito prevalece sobre un `.env` del desarrollador) y comprueba: respuesta válida (cuerpo exacto, JSON, `no-store`, sin cabeceras de servidor, `HEAD` 200, `POST` no 2xx, valor `SENTINELA` ausente de cuerpo, cabeceras y registro), `start.ts` con configuración inválida (código 1, sin escuchar, sin valores en la salida) y `entry.mjs` directo con configuración inválida (`/api/health` 500 genérico, no "ok"). El servidor hijo se cierra siempre.
- Script único `test:health` (`bun test ./tests/integration/health.test.ts`); lo incluyen `test:integration` y `test`. No hay un `health` aparte contra un servidor ya levantado.
- Utilidades compartidas con la prueba de `api-errors` en `tests/support/servidor.ts` (puerto libre, captura de salida, arranque y cierre de procesos), para no duplicar código.
- Efecto conocido: la prueba genera el `dist/` de la raíz (ignorado por Git) y sobrescribe el del desarrollador.
- Si en H1 la salud incluirá la base de datos o habrá un endpoint de *readiness* aparte: **no decidido**, se anota en la documentación.
- H0 no se cierra con esta issue: quedan las issues #9, #10 y #11.

## A cargo del constructor
Texto exacto de los mensajes de las pruebas; detalle de la utilidad compartida; qué filas de docs actualizar.
