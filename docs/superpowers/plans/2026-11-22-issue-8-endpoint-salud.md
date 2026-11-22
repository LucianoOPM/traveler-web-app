# Issue #8 — Endpoint de salud y prueba de salud local: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** `bun run test:health` construye y arranca la app real, comprueba que `GET /api/health` responde `{ "status": "ok" }` sin exponer nada y que una configuración inválida impide arrancar o responder "ok".

**Architecture:** Un endpoint mínimo (`src/pages/api/health.ts`); el middleware existente ya valida la configuración en cada petición. La prueba de integración usa utilidades compartidas (`tests/support/servidor.ts`) para arrancar procesos reales.

**Tech Stack:** Astro 7.4.13 (CLI `astro build`), Bun 1.4.4 (`bun test`, `Bun.spawn`). Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-8-endpoint-salud-design.md`

## Global Constraints

- Respuesta exacta `{ "status": "ok" }`, `200`, `Cache-Control: no-store`; nada de configuración, versiones ni base de datos.
- La prueba no puede depender de `.env`, PostgreSQL ni servicios externos; el entorno explícito de la prueba prevalece sobre un `.env` del desarrollador.
- El servidor hijo se cierra siempre (también si una prueba falla). Las pruebas existentes (49) deben seguir pasando.
- Sin cambios al middleware, a los errores tipados ni a la validación de configuración. Sin ADR.
- Sin Python; Bun/Node. Commits en Conventional Commits; rama `feat/h0-endpoint-salud` (ya creada); PR a `dev` con `Closes #8`. Antes de cada commit: `bun run format`, `bun run lint`, `bun run check`.

## Review Focus

- Con `AUTH_SECRET` corto, `bun scripts/start.ts` debe salir con 1 **sin escuchar** ni imprimir "Server listening"; con `entry.mjs` directo debe responder 500, nunca "ok".
- Un valor `SENTINELA` en `AUTH_SECRET` o en la contraseña de `DATABASE_URL` no debe aparecer en cuerpo, cabeceras ni salida del servidor.
- Un `.env` inválido en la raíz del desarrollador no debe cambiar el resultado de la prueba.
- La refactorización de `api-errors.test.ts` no debe cambiar su comportamiento (9 pruebas siguen en verde).
- Puertos libres, cierre de procesos hijos (también con una prueba que falla) y que `astro build` de la raíz no deje archivos sin ignorar.

---

### Task 1: Utilidades compartidas y refactor de la prueba existente

**Files:**
- Create: `tests/support/servidor.ts`
- Modify: `tests/integration/api-errors.test.ts` (usar las utilidades)

**Interfaces:**
- Produces (consumido por la Task 2):
  - `function puertoLibre(): Promise<number>`
  - `type ProcesoPrueba = { salida: () => string; salio: Promise<number>; detener: () => Promise<void> }`
  - `function lanzar(comando: string[], opciones: { cwd: string; env: Record<string, string | undefined> }): ProcesoPrueba`
  - `function esperarRespuesta(url: string, limiteMs?: number): Promise<void>` (reintenta hasta recibir 200)

- [ ] **Step 1: Extraer** de `api-errors.test.ts` las funciones `puertoLibre` y `acumular` y el arranque/cierre del hijo a `tests/support/servidor.ts` con las firmas de Interfaces (`salio` resuelve con el código de salida del proceso; `detener` mata el proceso y espera a que termine, sin lanzar si ya terminó).
- [ ] **Step 2: Reescribir `api-errors.test.ts`** para usar `puertoLibre`, `lanzar` y `esperarRespuesta` sin cambiar sus casos ni sus nombres.
- [ ] **Step 3: Verificar que no cambió el comportamiento.** Run: `bun run test:integration`. Expected: 9 pruebas en verde; luego `bun run format && bun run lint && bun run check`. Expected: exit 0.
- [ ] **Step 4: Commit.**

```bash
git add tests/support tests/integration/api-errors.test.ts
git commit -m "refactor: extraer utilidades de servidores de prueba a tests/support"
```

### Task 2: Endpoint de salud y prueba de salud local (TDD)

**Files:**
- Create: `src/pages/api/health.ts`, `tests/integration/health.test.ts`

**Interfaces:**
- Consumes: `puertoLibre`, `lanzar`, `esperarRespuesta`, `ProcesoPrueba` (Task 1); `scripts/start.ts` y `dist/server/entry.mjs` de la app real.
- Produces: `GET /api/health` → `200 { "status": "ok" }`.

- [ ] **Step 1: Escribir `tests/integration/health.test.ts` (RED).** `beforeAll` (timeout 180 s): `bunx astro build` en la raíz con el entorno válido explícito de la prueba de configuración (más `NODE_ENV=production`) y `AUTH_SECRET`/contraseña de `DATABASE_URL` con `SENTINELA-XYZ`; luego `bun scripts/start.ts` con `PORT`/`HOST` y ese entorno. Casos con nombres exactos:
  - `GET /api/health responde 200 con el cuerpo exacto y sin exponer nada` (cuerpo `{ status: "ok" }`; `content-type` JSON; `cache-control` contiene `no-store`; no hay cabeceras `server` ni `x-powered-by`; ni cuerpo ni cabeceras contienen `SENTINELA`).
  - `HEAD /api/health responde 200`.
  - `POST /api/health no se acepta` (estado 4xx, no 2xx).
  - `el registro del servidor no contiene secretos` (tras las peticiones, la salida capturada no contiene `SENTINELA`).
  - `start con AUTH_SECRET corto sale con código 1 sin escuchar` (nuevo proceso con `AUTH_SECRET=corto`; `salio` resuelve 1; la salida contiene `AUTH_SECRET:` y no contiene `Server listening` ni el valor; `fetch` al puerto falla).
  - `entry.mjs directo con configuración inválida no responde ok` (`bun dist/server/entry.mjs` con `AUTH_SECRET=corto`; esperar a que responda; `GET /api/health` → 500 con `{ error: { code: "internal_error", message: "Error interno del servidor" } }`; el cuerpo no es `{ status: "ok" }`).
- [ ] **Step 2: Run** `bun test ./tests/integration/health.test.ts`. Expected: FAIL (no existe `/api/health`: 404).
- [ ] **Step 3: Implementar `src/pages/api/health.ts`:** `export const GET: APIRoute` que devuelve `Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } })`. Comprobar que `prerender` no aplica (output server).
- [ ] **Step 4: Run** `bun test ./tests/integration/health.test.ts`. Expected: todo en verde; si un caso de configuración inválida no se comporta como se midió, registrar un `Ruling:` y corregir la prueba solo si la medición estaba mal, nunca debilitar la aserción.
- [ ] **Step 5: Comprobar el cierre de procesos.** Comparar `netstat -ano | grep LISTENING` antes y después de la prueba, también con una copia temporal que falle a propósito. Expected: ningún puerto nuevo.
- [ ] **Step 6: Comprobar que un `.env` inválido no influye.** Crear temporalmente `.env` con `AUTH_SECRET=corto` en la raíz, ejecutar la prueba y borrarlo. Expected: sigue en verde. Run: `git status --short`. Expected: sin archivos sin ignorar (`dist/` y `.astro/` ignorados).
- [ ] **Step 7: Commit.**

```bash
git add src/pages/api/health.ts tests/integration/health.test.ts
git commit -m "feat: añadir GET /api/health y prueba de salud local"
```

### Task 3: Script, clon limpio y documentación

**Files:**
- Modify: `package.json` (`test:health`), `docs/04-ingenieria/09-development-guide.md` (tabla de scripts: `test:health`, nuevos totales; sección "Salud local"), `docs/02-diseno/07-api-contracts.md` (endpoint de salud y lo no decidido sobre BD/readiness), `docs/04-ingenieria/10-testing-and-quality.md` (conteos y la prueba de salud), `docs/00-estado.md` (H0 y siguiente: issue #9), `CLAUDE.md` (scripts)

- [ ] **Step 1: Script.** Añadir `"test:health": "bun test ./tests/integration/health.test.ts"`. Run: `bun run test:health`. Expected: verde.
- [ ] **Step 2: Clon limpio.** `git clone` de la rama, `bun install --frozen-lockfile`, sin `.env`, entorno saneado: `bun run test:health` y `bun run test`; también `lint` y `format:check`. Expected: exit 0; anotar la duración de `test:health`.
- [ ] **Step 3: Documentación** (con Edit): qué responde y qué no, que "ok" implica configuración válida, cómo falla con configuración inválida, que la prueba sobrescribe el `dist/` de la raíz, los totales de pruebas reales, y que la salud no comprueba la base de datos (la decisión de incluirla en la salud o crear un endpoint de *readiness* queda sin decidir para H1). No afirmar que H0 está cerrado.
- [ ] **Step 4: Verificar.** Run: `bun run format:check && bun run lint && bun run check && bun run test`. Expected: exit 0.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "docs: documentar el endpoint de salud y el script test:health"
```

- [ ] **Step 6: Revisión independiente, correcciones y PR (pedir confirmación antes del push).** `git push -u origin feat/h0-endpoint-salud` y `gh pr create --base dev` con `Closes #8`.

---

## Autorrevisión

- Cubre las 3 tareas de la issue: endpoint sin efectos ni secretos (T2), prueba que valida la respuesta y falla con configuración inválida (T2), script `test:health` (T3).
- Criterio de aceptación: prueba de salud local reproducible desde un clon limpio (T3 paso 2).
- Interfaces consistentes: `puertoLibre`, `lanzar`, `esperarRespuesta` y `ProcesoPrueba` se definen en la Task 1 y se usan con esos nombres en la Task 2.
