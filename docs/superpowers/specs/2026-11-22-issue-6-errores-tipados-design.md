# Issue #6 — Manejo de errores tipados (diseño)

**Aprobado por el responsable en la conversación (2026-11-22), con los ajustes recogidos aquí.** Tamaño: cambio pequeño-mediano (dos módulos en `src/lib`, middleware, prueba de integración, documentación).

## Intención
Que cualquier endpoint pueda lanzar un error tipado y reciba una respuesta HTTP uniforme, y que los errores inesperados se registren en servidor y devuelvan una respuesta genérica, sin exponer trazas, causas, rutas internas ni secretos. Criterio de aceptación de la issue: cualquier endpoint puede lanzar un error tipado y recibir respuesta uniforme.

## Metas
- `src/lib/errors.ts`: `AppError` y siete subclases con código estable en `snake_case`.
- `src/lib/error-response.ts`: `toErrorResponse` (función pura que devuelve `Response`) y registro controlado de errores inesperados con `console.error`, sin biblioteca.
- `src/middleware.ts`: convierte lo que lancen los endpoints de `/api/`; fuera de `/api/` se conserva el manejo de errores de Astro.
- Pruebas unitarias de todos los códigos HTTP y **prueba de integración real** (build de un proyecto Astro de prueba + servidor real) de que los errores de endpoints llegan al middleware.

## No metas
Observabilidad avanzada, biblioteca de logging, `requestId`, rate limiting (429 reservado), integración con bibliotecas de validación (PEN-10 sigue abierto), JSON para rutas `/api/` inexistentes (404) o métodos no permitidos (405), cambios a `ConfigError`.

## Anti-metas
Que `stack`, `cause`, mensajes de errores inesperados, rutas internas o secretos aparezcan en una respuesta o en el log; confiar en propiedades `status`/`code` de objetos arbitrarios; reemplazar solo el valor de `AUTH_SECRET` en los logs como única defensa; duplicar la lógica de conversión.

## Contrato (de `docs/02-diseno/07-api-contracts.md`, borrador orientativo)
Respuesta de error: `{ "error": { "code": "...", "message": "..." } }`.

| Clase | Estado | Código por defecto |
|---|---|---|
| `ValidationError` | 400 | `validation_error` |
| `UnauthenticatedError` | 401 | `unauthenticated` |
| `ForbiddenError` | 403 | `forbidden` |
| `NotFoundError` | 404 | `not_found` |
| `ConflictError` | 409 | `conflict` |
| `BusinessRuleError` | 422 | `business_rule_violation` |
| `InternalError` | 500 | `internal_error` |

## Decisiones tomadas
- **Códigos:** `snake_case` (`/^[a-z][a-z0-9_]*$/`), con valor por defecto por clase y posibilidad de uno específico (`capacity_exceeded`, `already_boarded`). Un código con formato inválido hace fallar la construcción con `TypeError` (error de programación, visible en pruebas).
- **Mensaje público:** el `message` de un `AppError` (no 500) se devuelve tal cual; quien lo lanza es responsable de que sea seguro (sin valores del usuario ni datos técnicos).
- **`InternalError` y errores desconocidos:** se tratan igual: se registran y se responde `500` con `{ code: "internal_error", message: "Error interno del servidor" }`; el mensaje y la `cause` nunca salen.
- **Solo `instanceof AppError` cuenta como error tipado;** un objeto con `status`/`code` propios se trata como inesperado.
- **`ValidationError.details?: { field: string; message: string }[]`:** se serializa **solo** `field` y `message` (se descartan otras propiedades en tiempo de ejecución); independiente de Zod; `details` solo aparece en errores de validación.
- **Registro (único punto, `console.error`, una línea JSON):** `{ time, event: "unexpected_error", errorName, errorCode?, method, path, frames? }`. `errorName` y `errorCode` solo si cumplen un patrón seguro (`/^[A-Za-z0-9_$.]{1,80}$/` y `/^[A-Za-z0-9_]{1,40}$/`); `path` es solo el `pathname` (sin query ni fragmento); **nunca** el mensaje, la `cause`, el objeto `Error`, la solicitud, cabeceras ni cuerpo. `frames` (máx. 5 líneas `at …` del stack, sin la línea del mensaje) solo fuera de producción (`import.meta.env.DEV`).
- **Middleware:** `try { getConfig(); return await next(); } catch (error) { if (!esApi) throw error; return toErrorResponse(...) }`. **Condicionado a verificar en Astro** (prueba de integración) que el error del endpoint llega al `catch`; si Astro lo intercepta antes, se usa el mecanismo compatible que reutilice `toErrorResponse` sin duplicar la conversión.
- `ConfigError` sigue siendo un error de arranque independiente; en una petición saldría como inesperado.
- ADR nuevo: **ADR-019**. Pendiente nuevo: **PEN-14** (biblioteca/estrategia de logging).

## Enfoques
1. **Middleware que captura en `/api/` + función pura de conversión (elegido):** uniforme para cualquier endpoint, sin envolver cada ruta.
2. **Envoltorio por endpoint (`withApiErrors(handler)`):** respaldo si Astro no propaga el error al middleware; la conversión sigue en `toErrorResponse`.
3. **Página `500.astro`:** descartada para API; sirve páginas, no JSON.

## A cargo del constructor
Mensajes en español de los errores genéricos; estructura exacta del proyecto de prueba en `tests/fixtures/api-errors/`; cómo capturar la salida del servidor real en la prueba de integración; si hace falta un `.astro/` ignorado en el fixture (ya cubierto por `.gitignore`).
