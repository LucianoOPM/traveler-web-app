# Issue #6 — Manejo de errores tipados: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** Cualquier endpoint `/api/` puede lanzar un `AppError` y recibe `{ error: { code, message } }`; los errores inesperados se registran de forma controlada y responden `internal_error` genérico.

**Architecture:** `errors.ts` (clases) y `error-response.ts` (`toErrorResponse` + log) son puros y se prueban con `bun test`. `src/middleware.ts` los aplica a `/api/`. Un proyecto Astro de prueba (`tests/fixtures/api-errors/`) se construye y se sirve de verdad para comprobar la captura real.

**Tech Stack:** Astro 7.4.13 (CLI `astro build --root`), Bun 1.4.4 (`bun test`, `Bun.spawn`), sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-6-errores-tipados-design.md`

## Global Constraints

- Sin dependencias nuevas ni biblioteca de logging; registro solo con `console.error`.
- Formato de respuesta `{ "error": { "code", "message" } }`; códigos `snake_case` (`/^[a-z][a-z0-9_]*$/`); estados 400, 401, 403, 404, 409, 422, 500. 429 reservado (no implementar).
- **Nunca** en una respuesta ni en el log: `stack`, `cause`, mensaje de errores inesperados, objeto `Error`, solicitud, cabeceras, cuerpo, query string. `frames` solo si `import.meta.env.DEV`.
- Solo `instanceof AppError` es un error tipado. `InternalError` y errores desconocidos → `500` genérico y registro.
- `ValidationError.details` independiente de Zod; se serializa solo `field` y `message`.
- Fuera de `/api/` se conserva el manejo de errores de Astro. `ConfigError` no cambia.
- Context7/Astro: los endpoints devuelven `Response`; la API programática de Astro es experimental, por eso la prueba usa la CLI documentada.
- Sin Python; Bun/Node. Commits en Conventional Commits; rama `feat/h0-errores-tipados` (ya creada); PR a `dev` con `Closes #6`. Antes de cada commit: `bun run format`, `bun run lint`, `bun run check`.
- Fuera de alcance: observabilidad, `requestId`, rate limiting, PEN-10, JSON para `/api/` inexistentes (404) o 405.

## Review Focus

- **Astro puede no propagar el error al `catch` del middleware** (devolver un `Response` 500 en `next()`): la Task 1 lo mide y decide el mecanismo; no asumir.
- Un `Error` inesperado con `SENTINELA` en `message` y en `cause` no debe aparecer en la respuesta **ni** en la salida del servidor real.
- Valores lanzados que no son `Error` (`throw "texto"`, `throw { status: 404, code: "x" }`) → `500` genérico.
- Una URL con `?token=SENTINELA` no debe llegar al log; solo el `pathname`.
- `details` con una propiedad extra (`value: "SENTINELA"`) en tiempo de ejecución no debe serializarse.
- Un código inválido (`"CapacityExceeded"`) debe fallar al construir.
- Una página fuera de `/api/` que lance un error conserva el manejo de Astro (no responde nuestro JSON).
- La prueba de integración debe cerrar el servidor hijo aunque falle (Windows).

---

### Task 1: Experimento previo — ¿llega el error del endpoint al middleware? (y proyecto de prueba)

**Files:**
- Create: `tests/fixtures/api-errors/astro.config.mjs`, `tests/fixtures/api-errors/src/middleware.ts`, `tests/fixtures/api-errors/src/pages/api/{ok,conflict,validation,unexpected,non-error}.ts`, `tests/fixtures/api-errors/src/pages/{index,boom}.astro` (el fixture se conserva; el middleware de prueba de este paso es temporal)

**Interfaces:**
- Produces: el fixture (consumido por la Task 4) y un `Ruling:` con el mecanismo de captura: A (`try/catch` alrededor de `await next()`), B (inspeccionar la `Response` 500 de `next()`) o C (envoltorio por endpoint).

- [ ] **Step 1: Crear el fixture mínimo.** `astro.config.mjs` con `output: "server"` y `node({ mode: "standalone" })`; endpoints que lanzan: `conflict` (un error propio provisional, `Object.assign(new Error("x"), { status: 409 })`), `unexpected` (`throw new Error("SENTINELA-XYZ")`), `non-error` (`throw "SENTINELA-XYZ"`), `ok` (200 JSON); `boom.astro` lanza en el frontmatter; `index.astro` normal. `src/middleware.ts` **temporal**: `defineMiddleware(async (_c, next) => { try { const r = await next(); console.log("[spike] next() resolvió", r.status); return r; } catch (e) { console.log("[spike] next() rechazó", typeof e); return new Response("capturado", { status: 599 }); } })`.
- [ ] **Step 2: Construir y servir de verdad.** Run: `bunx astro build --root tests/fixtures/api-errors` y luego arrancar `bun tests/fixtures/api-errors/dist/server/entry.mjs` con `PORT=<libre>` y `HOST=127.0.0.1`. Con `curl` pedir `/api/unexpected`, `/api/non-error`, `/api/ok`, `/boom`. Anotar para cada uno: código HTTP, cuerpo y las líneas `[spike]` del log del servidor.
- [ ] **Step 3: Decidir.** Si `/api/unexpected` devuelve 599 con "next() rechazó": mecanismo A. Si devuelve 500 con "next() resolvió": mecanismo B (o C si B no distingue endpoints de páginas). Registrar un `Ruling:` con la evidencia. Detener el servidor (por su puerto) y **dejar el `src/middleware.ts` del fixture como re-export de producción**: `export { onRequest } from "../../../../src/middleware";` (se hará efectivo en la Task 4).
- [ ] **Step 4: Verificar que no se ensució el repo.** Run: `git status --short`. Expected: solo `tests/fixtures/api-errors/` (sin `dist/` ni `.astro/`, ignorados por `.gitignore`).

### Task 2: Jerarquía de errores (TDD)

**Files:**
- Create: `src/lib/errors.ts`, `tests/unit/errors.test.ts`

**Interfaces:**
- Produces (consumido por Tasks 3 y 4):
  - `class AppError extends Error { readonly code: string; readonly status: number; constructor(message: string, options?: { code?: string; cause?: unknown }) }`
  - `class ValidationError extends AppError { readonly details?: ErrorDetail[]; constructor(message: string, options?: { code?: string; details?: ErrorDetail[]; cause?: unknown }) }`
  - `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `BusinessRuleError`, `InternalError` (todas `extends AppError`, mismo constructor que `AppError`)
  - `type ErrorDetail = { field: string; message: string }`
  - `const ERROR_CODE_PATTERN: RegExp` (`/^[a-z][a-z0-9_]*$/`)

- [ ] **Step 1: Tests (RED)** en `tests/unit/errors.test.ts`, nombres exactos:
  - `cada clase usa su estado y su código por defecto` (tabla del spec: `[ValidationError,400,"validation_error"]`, `[UnauthenticatedError,401,"unauthenticated"]`, `[ForbiddenError,403,"forbidden"]`, `[NotFoundError,404,"not_found"]`, `[ConflictError,409,"conflict"]`, `[BusinessRuleError,422,"business_rule_violation"]`, `[InternalError,500,"internal_error"]`).
  - `conserva un código específico` (`new ConflictError("No hay capacidad disponible", { code: "capacity_exceeded" })` → `code === "capacity_exceeded"`, `status === 409`, `message` intacto; y `already_boarded` con `BusinessRuleError`).
  - `rechaza códigos que no son snake_case` (`"CapacityExceeded"`, `"capacity-exceeded"`, `""`, `"1abc"` lanzan `TypeError`).
  - `es instancia de Error y de AppError, con cause opcional` (`error.cause` conserva lo pasado).
  - `ValidationError conserva details como lista de field y message` (y es `undefined` si no se pasa).
- [ ] **Step 2: Run** `bun test tests/unit/errors.test.ts`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** en `src/lib/errors.ts` las firmas de Interfaces; el constructor valida el código con `ERROR_CODE_PATTERN` y asigna `name` según la clase.
- [ ] **Step 4: Run** `bun test tests/unit && bun run check && bun run lint`. Expected: todo en verde.
- [ ] **Step 5: Commit.**

```bash
git add src/lib/errors.ts tests/unit/errors.test.ts
git commit -m "feat: añadir jerarquía de errores tipados con códigos estables"
```

### Task 3: Conversión a respuesta y registro controlado (TDD)

**Files:**
- Create: `src/lib/error-response.ts`, `tests/unit/error-response.test.ts`

**Interfaces:**
- Consumes: `AppError`, `ValidationError`, `ErrorDetail` (Task 2).
- Produces (consumido por Task 4):
  - `type ErrorContext = { method: string; path: string; includeFrames?: boolean }`
  - `function toErrorResponse(error: unknown, context: ErrorContext): Response`
  - `const INTERNAL_ERROR_MESSAGE = "Error interno del servidor"`

- [ ] **Step 1: Tests (RED)** en `tests/unit/error-response.test.ts` (espiar `console.error` con `spyOn` de `bun:test` y restaurarlo), nombres exactos:
  - `convierte cada AppError en { error: { code, message } } con su estado` (los 6 tipados no-500; `content-type` JSON; cuerpo exacto).
  - `preserva el código específico en la respuesta`.
  - `serializa details solo con field y message` (pasar un detalle con `value: "SENTINELA-XYZ"` forzado con un cast; el cuerpo no contiene `SENTINELA`) y `details` ausente en errores que no son de validación.
  - `un error inesperado responde 500 internal_error genérico` (`new Error("SENTINELA-XYZ", { cause: new Error("SENTINELA-XYZ") })`; cuerpo exactamente `{ error: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE } }`; el texto de la respuesta no contiene `SENTINELA`, `stack` ni `at `).
  - `InternalError explícito se trata como inesperado` (su mensaje no sale; se registra).
  - `los valores lanzados que no son Error responden 500 genérico` (`"texto"`, `null`, `{ status: 404, code: "no_confiar" }`: estado 500 y código `internal_error`).
  - `registra una sola línea JSON controlada` (`console.error` llamado 1 vez con un único `string`; al parsearlo tiene `event: "unexpected_error"`, `errorName`, `method`, `path` y **no** contiene `SENTINELA`, el mensaje, la cause ni `stack`).
  - `el log usa solo el pathname` (`path: "/api/v1/x?token=SENTINELA-XYZ#frag"` → el registro no contiene `SENTINELA` ni `?`).
  - `errorName y errorCode solo con formato seguro` (un `Error` con `name = "Raro con espacios SENTINELA"` → `errorName` es `"Error"`; con `code = "ECONNREFUSED"` se registra; con `code = "con SENTINELA"` no).
  - `frames solo con includeFrames` (sin la opción no hay `frames`; con ella hay ≤ 5 líneas que empiezan por `at ` y ninguna contiene el mensaje del error).
  - `los errores tipados no se registran`.
- [ ] **Step 2: Run** `bun test tests/unit/error-response.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar** `toErrorResponse` y el registro (`logUnexpectedError`, no exportado salvo que un test lo necesite) en `src/lib/error-response.ts`; helpers locales para sanear `errorName`, `errorCode`, `path` y `frames` según el spec; `Response.json(..., { status })`.
- [ ] **Step 4: Run** `bun test tests/unit && bun run check && bun run lint`. Expected: verde.
- [ ] **Step 5: Commit.**

```bash
git add src/lib/error-response.ts tests/unit/error-response.test.ts
git commit -m "feat: convertir errores a respuestas uniformes con registro controlado"
```

### Task 4: Middleware y prueba de integración real

**Files:**
- Modify: `src/middleware.ts`, `tests/fixtures/api-errors/src/middleware.ts` (re-export), endpoints del fixture (usar las clases reales de `src/lib/errors`)
- Create: `tests/integration/api-errors.test.ts`

**Interfaces:**
- Consumes: `toErrorResponse` (Task 3), clases (Task 2), fixture y `Ruling:` (Task 1).

- [ ] **Step 1: Escribir la prueba de integración (RED).** En `tests/integration/api-errors.test.ts`: `beforeAll` (timeout generoso, p. ej. 180 s) construye el fixture con `Bun.spawn(["bunx","astro","build","--root","tests/fixtures/api-errors"])` desde la raíz del repo, obtiene un puerto libre (`net.createServer().listen(0)`), y arranca `bun tests/fixtures/api-errors/dist/server/entry.mjs` con `PORT`, `HOST=127.0.0.1` y las 8 variables válidas de `tests/unit/config.test.ts` (mismo `base`), capturando stdout/stderr; espera hasta que `GET /api/ok` responda. `afterAll` termina el proceso hijo. Casos con nombres exactos:
  - `un ConflictError lanzado por un endpoint responde 409 con su código` (`/api/conflict` → 409, `{ error: { code: "capacity_exceeded", message: "No hay capacidad disponible" } }`).
  - `un ValidationError responde 400 con details` (`/api/validation`).
  - `un error inesperado responde 500 genérico sin filtrar nada` (cuerpo sin `SENTINELA`, `stack`, ni rutas; el log del servidor tiene una línea `unexpected_error` y **no** contiene `SENTINELA`).
  - `un valor lanzado que no es Error responde 500 genérico` (`/api/non-error`).
  - `un endpoint correcto no se altera` (`/api/ok` → 200).
  - `una página fuera de /api/ conserva el manejo de errores de Astro` (`/boom` → 500 y el cuerpo **no** es nuestro JSON; `/` → 200).
  - `la query string no llega al log` (pedir `/api/unexpected?token=SENTINELA-XYZ`; la salida del servidor no contiene `SENTINELA`).
- [ ] **Step 2: Run** `bun test tests/integration/api-errors.test.ts`. Expected: FAIL (el middleware de producción aún no convierte).
- [ ] **Step 3: Actualizar los endpoints del fixture** para lanzar `ConflictError`/`ValidationError` reales (importados de `src/lib/errors`) y dejar `unexpected` y `non-error` con `SENTINELA-XYZ`.
- [ ] **Step 4: Implementar `src/middleware.ts`** según el `Ruling:` de la Task 1 (mecanismo A, B o C), manteniendo `getConfig()` y delegando **siempre** en `toErrorResponse`; solo para rutas que empiezan por `/api/`; `includeFrames: import.meta.env.DEV`; el resto se relanza o se devuelve sin tocar.
- [ ] **Step 5: Run** `bun test tests/integration tests/unit && bun run check && bun run lint && bun run format:check`. Expected: todo verde (anotar el tiempo de la integración).
- [ ] **Step 6: Comprobar el cierre del hijo.** Run: `netstat -ano | grep LISTENING` filtrando el puerto usado. Expected: ningún proceso queda escuchando tras la prueba.
- [ ] **Step 7: Commit.**

```bash
git add src/middleware.ts tests
git commit -m "feat: capturar errores de endpoints /api/ en el middleware con prueba de integración"
```

### Task 5: Documentación y PR

**Files:**
- Modify: `docs/02-diseno/07-api-contracts.md` (convenciones: `details` solo en 400, `422`, códigos específicos, `500 internal_error`; sigue siendo borrador), `docs/04-ingenieria/09-development-guide.md` (sección "Errores tipados": cómo lanzar, mensaje público seguro, qué se registra y qué nunca, comando de la prueba de integración y su duración), `docs/05-decisiones/11-decisions-and-risks.md` (ADR-019 + fila), `docs/05-decisiones/pendientes.md` (PEN-14: biblioteca/estrategia de logging), `docs/00-estado.md` (H0; siguiente: issue #7), `CLAUDE.md` si la línea de Estado lo requiere

- [ ] **Step 1: Escribir ADR-019** con: decisión, el `Ruling:` de la Task 1 (qué mecanismo y la evidencia), alternativas (envoltorio por endpoint, `500.astro`), consecuencias (los mensajes de `AppError` son públicos; 404/405 de rutas inexistentes siguen sin JSON; `frames` solo fuera de producción; PEN-14).
- [ ] **Step 2: Actualizar el resto** con Edit; no afirmar scripts inexistentes ni resolver PEN-10.
- [ ] **Step 3: Verificar.** Run: `bun run format:check && bun run lint && bun run check && bun test tests/unit tests/integration`. Expected: exit 0 en todo.
- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "docs: ADR-019 de errores tipados, contrato de API y guía actualizados"
```

- [ ] **Step 5: Revisión independiente, correcciones y PR (pedir confirmación antes del push).** `git push -u origin feat/h0-errores-tipados` y `gh pr create --base dev` con `Closes #6`.

---

## Autorrevisión

- Cubre las 4 tareas de la issue: jerarquía (T2), conversión sin filtrar (T3), inesperados registrados y genéricos (T3-T4), pruebas del mapeo a HTTP (T2-T3), más la captura real en endpoints (T1, T4).
- Cada punto de la sección 7 de la aprobación tiene su prueba: conversión por clase, códigos específicos, `details` seguro, genérico ante inesperados, ausencia de datos sensibles, registro controlado, captura real y comportamiento fuera de `/api/`.
- Tipos consistentes: `AppError`, `ErrorDetail`, `ErrorContext`, `toErrorResponse`, `INTERNAL_ERROR_MESSAGE`, `ERROR_CODE_PATTERN` se definen en las Interfaces y se usan con esos nombres.
- La Task 1 evita asumir el comportamiento de Astro: el mecanismo A/B/C sale de una medición.
