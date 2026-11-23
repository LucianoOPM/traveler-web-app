# Issue #4 — Configuración de entorno y validación: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** La aplicación no arranca con configuración inválida y ningún secreto llega al cliente, a logs ni a `dist/`.

**Architecture:** `loadConfig(raw, options?)` es una función pura (Zod 4 vía `astro/zod`) en `src/lib/config.ts`, probada con `bun test`. Un adaptador fino lee el entorno en servidor; se valida en `astro.config.mjs` (dev/build) y en `scripts/start.ts` (producción).

**Tech Stack:** Astro 7.4.13, `astro/zod` (Zod 4.6.7 interno de Astro), Bun 1.4.4 (`bun test`).

**Spec:** `docs/superpowers/specs/2026-11-22-issue-4-configuracion-entorno-design.md`

## Global Constraints

- Sin dependencias nuevas salvo, si hace falta para tipar `bun:test`, `@types/bun` **exacto** (anotar versión en ADR/guía). Zod solo se importa desde `astro/zod`.
- **Nunca** leer secretos con `import.meta.env` (hornea el valor en `dist/`, verificado).
- Errores de validación: nombre de variable y regla, **jamás el valor**.
- Todas las variables obligatorias; `NODE_ENV` ∈ `development|test|production`.
- `AUTH_SECRET` ≥ 32 caracteres y distinto de `GENERATE_A_LONG_RANDOM_SECRET`/`CHANGE_ME`; bases privada/demo con nombres de base distintos; `APP_ORIGIN` solo origen http(s); `AGENCY_TIMEZONE` IANA válida; storage dentro de `<raíz>/storage` o fuera de `<raíz>`, nunca bajo `public/`, rutas distintas y no anidadas.
- Zod 4: `z.url()`, `{ error: "..." }`, `superRefine` con `ctx.addIssue({ path })`, `z.prettifyError`. No usar la sintaxis de Zod 3.
- Fuera de alcance: PostgreSQL real, Better Auth, errores tipados (#6), infraestructura de pruebas (#7), lint (#5), resolver PEN-10 (queda abierto).
- Sin Python. Commits en Conventional Commits; rama `feat/h0-configuracion-entorno` (ya creada desde `dev`); PR a `dev` con `Closes #4`.

## Review Focus

- Con la validación en la primera petición el servidor arrancaría roto: `bun scripts/start.ts` con una variable inválida debe terminar con código ≠ 0 **antes** de escuchar en el puerto.
- Valores sentinela de secretos (`AUTH_SECRET`, contraseña de `DATABASE_URL`) no deben aparecer en `dist/client`, `dist/server`, ni en la salida de errores/logs.
- Rutas de storage con trampas: `../src`, `./storage/../public`, `./public/x`, vacía, igual entre privada y demo, una dentro de la otra, ruta absoluta de Windows (`C:\...`) fuera del repo.
- `getSecret`/`process.env` pueden devolver `undefined` en dev aunque exista `.env`: no debe aceptarse en silencio.
- Importar el módulo de lectura en servidor desde una isla React debe romper el build.

---

### Task 1: Experimento previo — de dónde leer el entorno (spike, no se commitea)

**Files:**
- Create (temporal, se borra): `src/pages/spike-env.astro`, `.env` (ignorado por Git)

**Interfaces:**
- Produces: un `Ruling:` en el ledger con la fuente de entorno elegida para el adaptador de la Task 3 (A: `getSecret` sin esquema; B: variables declaradas en `env.schema` como `context: "server", access: "secret"` y leídas desde `astro:env/server`; C: `process.env` + `loadEnv` de `vite`).

- [ ] **Step 1:** Con `.env` conteniendo `SPIKE_VAR=valor-sentinela-123`, crear `spike-env.astro` que muestre `getSecret("SPIKE_VAR")` de `astro:env/server`. Run: `bun run dev` y `curl http://localhost:4321/spike-env`. Anotar el resultado (valor o undefined).
- [ ] **Step 2:** Repetir declarando `SPIKE_VAR` en `env.schema` (`envField.string({ context: "server", access: "secret" })`) y leyéndola con `import { SPIKE_VAR } from "astro:env/server"`. Anotar el resultado en dev.
- [ ] **Step 3:** `bun run build` y comprobar `grep -rl valor-sentinela-123 dist | wc -l`. Expected: `0` (si no es 0, esa opción queda descartada). Después arrancar con `SPIKE_VAR=otro-valor bun ./dist/server/entry.mjs` (sin `.env`) y comprobar que el valor llega en tiempo de ejecución.
- [ ] **Step 4:** Probar si `bun scripts-prueba.ts` (archivo temporal) ve `process.env.SPIKE_VAR` con `.env` en la raíz (autocarga de Bun).
- [ ] **Step 5:** Elegir la fuente (A, B o C) con evidencia, escribir el `Ruling:` y **borrar** `spike-env.astro`, `.env` y los temporales. Run: `git status --short`. Expected: sin cambios nuevos.

### Task 2: `.env.example` y `loadConfig` (TDD)

**Files:**
- Create: `.env.example`, `src/lib/config.ts`, `tests/unit/config.test.ts` (y borrar `tests/unit/.gitkeep` y `src/lib/.gitkeep` al recibir su primer archivo)
- Modify: `package.json` solo si se añade `@types/bun` exacto

**Interfaces:**
- Produces (consumido por Tasks 3 y 4):
  - `type Config = { nodeEnv: "development" | "test" | "production"; databaseUrl: string; demoDatabaseUrl: string; authSecret: string; appOrigin: string; privateStorageDir: string; demoStorageDir: string; agencyTimezone: string }` (rutas ya resueltas a absolutas).
  - `class ConfigError extends Error { readonly issues: string[] }` (cada issue: `NOMBRE: regla`, sin valores).
  - `function loadConfig(raw: Record<string, string | undefined>, options?: { projectRoot?: string }): Config`; `projectRoot` por defecto `process.cwd()`.

- [ ] **Step 1: Escribir los tests (RED)** en `tests/unit/config.test.ts` con `bun:test`. Un `base` válido con `projectRoot` fijo (`/tmp/proyecto` o equivalente multiplataforma construido con `path.resolve`) y estos casos, con los nombres exactos:
  - `acepta una configuración válida y normaliza APP_ORIGIN` (`APP_ORIGIN: "http://localhost:4321/"` → `appOrigin === "http://localhost:4321"`; las rutas devueltas son absolutas).
  - `falla nombrando cada variable faltante` (para cada una de las 8 claves, quitarla y esperar `ConfigError` cuyo `issues` contenga `"<CLAVE>:"`).
  - `rechaza DATABASE_URL con protocolo no postgres` (`mysql://...`).
  - `rechaza bases privada y demo con el mismo nombre de base`.
  - `rechaza AUTH_SECRET corto o de ejemplo` (31 caracteres; `GENERATE_A_LONG_RANDOM_SECRET`; `CHANGE_ME`).
  - `rechaza zona horaria inválida` (`Mars/Olympus`).
  - `rechaza APP_ORIGIN con ruta` (`http://localhost:4321/app`).
  - `rechaza storage que escapa a otras carpetas del repo` (`../src`, `./storage/../src`, `./src/x`).
  - `rechaza storage bajo public/` (`./public/privado`, `./storage/../public`).
  - `rechaza storage vacío`.
  - `acepta storage absoluto fuera del repo` (ruta fuera de `projectRoot`).
  - `rechaza storage privado y demo iguales o anidados`.
  - `ningún mensaje de error contiene valores de secretos` (`AUTH_SECRET: "corto-secreto-XYZ"` y contraseña `p4ssw0rd-XYZ` en una URL inválida; `JSON.stringify(error.issues)` y `error.message` no contienen `XYZ`).
- [ ] **Step 2: Run** `bun test tests/unit/config.test.ts`. Expected: FAIL (módulo `src/lib/config` inexistente).
- [ ] **Step 3: Implementar `loadConfig`, `ConfigError` y `Config` en `src/lib/config.ts`** con `import { z } from "astro/zod"`: esquema por variable y `superRefine` para reglas entre campos (nombres de base, rutas distintas/anidadas), `z.prettifyError` **no** (puede incluir entradas); construir `issues` solo con `NOMBRE: regla` desde los `path`/`code` de Zod. Resolución de rutas con `node:path`; "dentro de" comparando `path.relative`.
- [ ] **Step 4: `.env.example`** con las 8 variables y valores ilustrativos de `09-development-guide.md` (sección Variables propuestas).
- [ ] **Step 5: Run** `bun test tests/unit/config.test.ts && bun run check`. Expected: todos los tests pasan y `astro check` con 0 errores (si falla por `bun:test`, añadir `@types/bun` exacto y repetir).
- [ ] **Step 6: Commit.**

```bash
git add .env.example src/lib tests/unit package.json bun.lock
git commit -m "feat: añadir loadConfig con validación de entorno y .env.example"
```

### Task 3: Arranque que falla con configuración inválida

**Files:**
- Create: `src/lib/config.runtime.ts`, `scripts/start.ts`, `src/middleware.ts` (y quitar `scripts/.gitkeep`)
- Modify: `astro.config.mjs`, `package.json` (script `start`)

**Interfaces:**
- Consumes: `loadConfig`, `Config`, `ConfigError` (Task 2) y la fuente de entorno decidida en Task 1.
- Produces: `function getConfig(): Config` (memoizada, solo servidor) en `src/lib/config.runtime.ts`; script `"start": "bun scripts/start.ts"`.

- [ ] **Step 1: Test que debe fallar (RED).** Con un `.env` válido temporal y `AUTH_SECRET=corto`, `bun run build && bun scripts/start.ts` aún no existe. Run: `bun scripts/start.ts; echo "exit=$?"`. Expected: error de archivo inexistente.
- [ ] **Step 2: Implementar `scripts/start.ts`:** leer `process.env`, llamar `loadConfig`; si lanza `ConfigError`, imprimir solo `issues` a stderr y `process.exit(1)`; si pasa, `await import("../dist/server/entry.mjs")`. Añadir `"start": "bun scripts/start.ts"`.
- [ ] **Step 3: Implementar `src/lib/config.runtime.ts`** con `getConfig()` usando la fuente elegida en Task 1 (importa `astro:env/server`; sin `import.meta.env`).
- [ ] **Step 4: Validar al arrancar dev/build:** en `astro.config.mjs` ejecutar `loadConfig` con el entorno de `loadEnv` de `vite` + `process.env` antes de `defineConfig`; ante `ConfigError` lanzar con las `issues`. Si Astro no resuelve la importación de un `.ts` desde `.mjs`, registrar un `Ruling:` y usar la alternativa mínima.
- [ ] **Step 5: `src/middleware.ts`** que llama `getConfig()` una vez como defensa adicional y continúa.
- [ ] **Step 6: Verificar GREEN y casos de fallo.** Con `.env` válido: `bun run check && bun run build` OK. Luego, para cada caso `AUTH_SECRET=corto`, base repetida y `PRIVATE_STORAGE_DIR=./public/x`: `bun run build` debe fallar en config y `bun run start` debe salir con código 1 **sin** imprimir "Server listening". Con `.env` válido: `bun run start` escucha en `:4321` y responde 200.
- [ ] **Step 7: Negativo de cliente.** Importar temporalmente `getConfig` desde `src/components/Counter.tsx` y ejecutar `bun run build`. Expected: FALLA el build (módulo solo servidor). Revertir el cambio.
- [ ] **Step 8: Commit.**

```bash
git add astro.config.mjs package.json src scripts bun.lock
git commit -m "feat: validar la configuración al arrancar (dev, build y start)"
```

### Task 4: Verificación de secretos, documentación y PR

**Files:**
- Modify: `docs/04-ingenieria/09-development-guide.md` (Variables: reglas de validación, script `start`, aviso sobre `import.meta.env`), `docs/05-decisiones/11-decisions-and-risks.md` (ADR-017), `docs/05-decisiones/pendientes.md` (nota en PEN-10: `astro/zod` candidato, sigue abierto; y, si procede, nueva fila "exigir https en producción"), `docs/00-estado.md`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Sentinelas.** Con `.env` válido cuyo `AUTH_SECRET` y contraseña de `DATABASE_URL` contengan `SENTINELA-XYZ`: `bun run build` y `grep -rl SENTINELA-XYZ dist | wc -l`. Expected: `0`. Provocar un error de configuración con esos mismos valores y comprobar que su salida no contiene `SENTINELA-XYZ`. Borrar `.env`.
- [ ] **Step 2: Verificación final.** Run: `bun test tests/unit && bun run check && bun run build`. Expected: todo en verde; `git status --short` sin `.env` ni `storage/`.
- [ ] **Step 3: Documentación.** Escribir ADR-017 (fuente de entorno elegida en Task 1, `astro/zod`, `start`, hallazgos medidos, PEN-10 abierto) y actualizar guía, `pendientes.md` y `00-estado.md` (siguiente: issue #5). Sin cifras del seed ni afirmar scripts inexistentes (`db:migrate`, `admin:create`, `demo:seed`).
- [ ] **Step 4: Commit.**

```bash
git add docs
git commit -m "docs: ADR-017 de configuración de entorno y guía actualizada"
```

- [ ] **Step 5: Push y PR (pedir confirmación antes).** `git push -u origin feat/h0-configuracion-entorno` y `gh pr create --base dev` con `Closes #4`, resumen y lo no probado.

---

## Autorrevisión

- Cubre las 6 tareas de la issue: `.env.example` (T2), módulo único en `src/lib` que valida y falla (T2-T3), rutas de storage (T2), selección de base solo en servidor (T3: módulo solo servidor + negativo de cliente), prueba unitaria con válida/faltante/ruta inválida (T2), no fijar la librería sin consultar (resuelto: `astro/zod`, PEN-10 abierto).
- Criterio de aceptación: "no arranca con configuración inválida" (T3 pasos 6) y "ningún secreto llega al cliente ni a logs" (T3 paso 7 y T4 paso 1).
- Tipos consistentes: `Config`, `ConfigError`, `loadConfig`, `getConfig` definidos en las Interfaces y usados con esos nombres.
- Proporción: lo no determinado por firmas y tests (mensajes exactos, helpers) se deja al constructor, según la spec.
