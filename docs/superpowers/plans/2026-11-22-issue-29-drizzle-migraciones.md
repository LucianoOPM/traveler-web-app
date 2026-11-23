# Issue #29 — Drizzle, conexión, `db:migrate` y ejecutor de rollback — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drizzle instalado con conexión `bun-sql`, `db:migrate` que aplica migraciones a la base privada o demo, y un ejecutor de rollback que revierte la última migración con su `down.sql`, **solo** sobre `traveltech_test`, manteniendo sincronizado el historial de Drizzle.

**Architecture:** Funciones pequeñas en `src/db/` (guardia de base de pruebas, objetivo de migración, lectura del journal y de los `down.sql`, `migrar`, `revertirUltimaMigracion`) y dos scripts delgados en `scripts/`. La guardia consulta `current_database()` en la propia conexión antes de cualquier operación destructiva. Las migraciones se aplican con el migrador programático de `drizzle-orm/bun-sql` (no con `drizzle-kit migrate`); `drizzle-kit` solo genera.

**Tech Stack:** `drizzle-orm` 0.45.4 y `drizzle-kit` 0.31.11 (exactas, ADR-015), `Bun.SQL` (`import { SQL } from "bun"`), `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-22-h1-issues-1-4-base-de-datos-design.md` (sección «Issue 2»). Issue de GitHub: #29. Plantilla del flujo: `docs/superpowers/plans/2026-11-22-issue-28-docker-compose.md`.

## Hechos verificados antes de escribir este plan
Experimento en un proyecto desechable con PostgreSQL 17 del `docker-compose.yml` (ya desmontado):
- `drizzle-kit generate --name <n>` crea `NNNN_<n>.sql`, `meta/NNNN_snapshot.json` y `meta/_journal.json` (`{ version: "7", dialect: "postgresql", entries: [{ idx, version: "7", when, tag, breakpoints: true }] }`). Funciona **sin** `pg` instalado.
- Un `NNNN_<n>.down.sql` junto a la migración **no estorba**: `drizzle-kit migrate` lo ignora y el migrador lo ignora (solo lee el journal).
- El historial es `drizzle.__drizzle_migrations(id serial, hash text, created_at bigint)`: `hash` es el SHA-256 del `.sql` y `created_at` es el `when` del journal. Bun devuelve `bigint` como **cadena**.
- El migrador solo compara el `created_at` de la **última** fila con el `when` del journal: borrar la fila de mayor `id` tras aplicar el `down.sql` hace que `migrate` vuelva a aplicar esa migración (verificado: migrar → revertir a mano → migrar programático).
- `sql.begin(tx => tx.unsafe(texto))` ejecuta varias sentencias y es atómico (un `down` que falla a mitad no deja cambios; verificado).
- `drizzle-kit` corre bajo Node y **no carga `.env`** (`url: undefined`); Bun sí lo carga. Por eso `db:migrate` usa el migrador programático bajo Bun.
- `import { drizzle } from "drizzle-orm/bun-sql"` y `import { migrate } from "drizzle-orm/bun-sql/migrator"` existen en 0.45.4.

## Global Constraints
- Versiones exactas de ADR-015 (`drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11), sin `^` ni `~`. Ninguna otra dependencia nueva.
- **Rulings del plan (a confirmar por el responsable al entregar):** (1) **no se instala `pg`**: solo lo exigía `drizzle-kit migrate`, que no se usa (ver «Hechos verificados»); se puede añadir después. (2) La **guardia** `asegurarBaseDePruebas` y el soporte mínimo de pruebas con PostgreSQL (`tests/support/base-de-pruebas.ts`) se crean **aquí** y no en la #30, porque el ejecutor de rollback y su prueba los necesitan; la #30 conserva `skipIf` con fallo en CI, el servicio de CI, el ADR-024 y la documentación. (3) Se añade el script `db:generate` (`drizzle-kit generate`) porque la #31 lo necesita. (4) La conexión es una función `abrirBase(url)` sin *singleton*: `getConfig()` usa `astro:env/server` y no existe en scripts; el acceso de ejecución con `getConfig()` llega con su primer consumidor (#31 y siguientes).
- `db:rollback` **solo opera sobre `traveltech_test`**; cualquier otro nombre de base lo rechaza la guardia antes de ejecutar SQL destructivo. Nunca rollback automático en `traveltech_private` ni `traveltech_demo`.
- `db:migrate` acepta únicamente `private` (por defecto) o `demo`, por argumento de línea de comandos; la URL sale de `loadConfig(process.env)`; nunca de una petición.
- Migración reversible = tiene `NNNN_<n>.down.sql`; irreversible = ese archivo contiene `-- IRREVERSIBLE: <motivo>` (motivo no vacío); el ejecutor se niega a revertirla.
- Mensajes y salidas **nunca** imprimen URLs, contraseñas ni valores de configuración.
- Sin Python; Node/Bun/bash. Commits en Conventional Commits; documentación en español. Rama `feat/h1-drizzle-migraciones` desde `dev`; PR hacia `dev` con `Closes #29`; push y PR solo con autorización del responsable.

## Review Focus
1. **`down.sql` que falla a mitad:** no debe quedar nada a medias ni perderse la fila del historial (Task 3, prueba de atomicidad).
2. **Rollback sobre otra base:** la guardia corre antes de cualquier SQL; una base `traveltech_private`, `traveltech_demo`, `postgres`, `traveltech_test_2`, `Traveltech_Test` o una consulta que falla se rechazan sin ejecutar nada más (Task 1 y Task 3).
3. **Migración irreversible o sin `down.sql`:** el ejecutor se niega sin tocar la base ni el historial; el verificador de reversibilidad detecta archivos ausentes, vacíos o con marcador sin motivo (Task 2 y Task 3).
4. **Historial desincronizado:** tras revertir, `migrate` vuelve a aplicar exactamente esa migración y el historial queda con una fila menos y luego una más (Task 3).
5. **Objetivo y carpeta vacíos:** `db:migrate` rechaza `test`, rutas, cadenas vacías y varios argumentos; sin migraciones generadas no falla ni inventa nada (Task 1 y Task 4).

## Estructura de archivos
- Crear `src/db/guardia.ts`: `BASE_DE_PRUEBAS`, `ConsultaSql`, `GuardiaBaseError`, `asegurarBaseDePruebas`.
- Crear `src/db/objetivo.ts`: `ObjetivoMigracion`, `ObjetivoInvalidoError`, `parsearObjetivo`, `urlDelObjetivo`.
- Crear `src/db/migraciones.ts`: `CARPETA_MIGRACIONES`, `EntradaJournal`, `leerJournal`, `rutaDown`, `motivoIrreversible`, `verificarReversibilidad`.
- Crear `src/db/conexion.ts` (`abrirBase`), `src/db/schema.ts` (vacío por ahora) y `src/db/migrar.ts` (`migrar`).
- Crear `src/db/rollback.ts`: `RollbackError`, `revertirUltimaMigracion`.
- Crear `drizzle.config.ts`, `scripts/db-migrar.ts`, `scripts/db-rollback.ts`. Borrar `src/db/.gitkeep`.
- Crear `tests/support/base-de-pruebas.ts` y fixtures `tests/fixtures/migraciones/{reversible,irreversible,down-roto}/`.
- Crear pruebas: `tests/unit/{guardia,objetivo,migraciones,rollback-guardia}.test.ts`, `tests/integration/db-rollback.test.ts`.
- Modificar `package.json` (dependencias y scripts), `bun.lock`, `docs/05-decisiones/11-decisions-and-risks.md` (ADR-023), `docs/01-producto/02-roadmap.md`, `docs/04-ingenieria/09-development-guide.md`, `docs/04-ingenieria/10-testing-and-quality.md`, `docs/superpowers/specs/2026-11-22-h1-issues-1-4-base-de-datos-design.md`, `README.md`, `docs/00-estado.md`, `CLAUDE.md`.

---

### Task 1: Guardia de base de pruebas y objetivo de migración (puras)

**Files:** Create `src/db/guardia.ts`, `src/db/objetivo.ts`, `tests/unit/guardia.test.ts`, `tests/unit/objetivo.test.ts`.

**Interfaces:**
- Produces: `BASE_DE_PRUEBAS = "traveltech_test"`; `type ConsultaSql = (strings: TemplateStringsArray, ...valores: unknown[]) => PromiseLike<Array<Record<string, unknown>>>`; `class GuardiaBaseError extends Error`; `asegurarBaseDePruebas(sql: ConsultaSql): Promise<void>`; `type ObjetivoMigracion = "private" | "demo"`; `class ObjetivoInvalidoError extends Error`; `parsearObjetivo(argumentos: string[]): ObjetivoMigracion`; `urlDelObjetivo(config: Pick<Config, "databaseUrl" | "demoDatabaseUrl">, objetivo: ObjetivoMigracion): string`.

- [ ] **Step 1: Crear la rama** `git switch dev && git pull && git switch -c feat/h1-drizzle-migraciones`.
- [ ] **Step 2: Escribir las pruebas que fallan.**
  - `guardia.test.ts` con un `sqlFalso(db: unknown)` que registra el texto de cada consulta (une `strings`) y devuelve `[{ db }]`. Tests: acepta `"traveltech_test"` (no lanza) y la consulta registrada contiene `current_database()`; rechaza con `GuardiaBaseError` (mensaje que **no** incluye el nombre recibido en bruto de una URL, solo el nombre de base) cuando devuelve `traveltech_private`, `traveltech_demo`, `postgres`, `traveltech_test_2`, `Traveltech_Test`, `""`, `null` y `undefined`; rechaza si la consulta lanza (propaga como `GuardiaBaseError`, no como éxito) y si devuelve una lista vacía.
  - `objetivo.test.ts`: `parsearObjetivo([])` → `"private"`; `["private"]` → `"private"`; `["demo"]` → `"demo"`; lanza `ObjetivoInvalidoError` con `["test"]`, `["../x"]`, `[""]`, `["Private"]`, `["private", "demo"]`. `urlDelObjetivo` devuelve `databaseUrl` para `private` y `demoDatabaseUrl` para `demo`.
- [ ] **Step 3: Ejecutar** `bun test ./tests/unit/guardia.test.ts ./tests/unit/objetivo.test.ts` → FALLAN (módulos inexistentes).
- [ ] **Step 4: Implementar** ambos módulos. La guardia ejecuta `sql\`select current_database() as db\``, exige igualdad estricta con `BASE_DE_PRUEBAS` y convierte cualquier fallo de la consulta en `GuardiaBaseError` (con `cause`).
- [ ] **Step 5: Ejecutar** las mismas pruebas → pasan. `bun run format`, `bun run lint`, `bun run check` → limpios.
- [ ] **Step 6: Commit** `feat(h1): añadir la guardia de base de pruebas y el objetivo de migración`.

---

### Task 2: Dependencias, conexión, journal y verificador de reversibilidad

**Files:** Create `src/db/migraciones.ts`, `src/db/conexion.ts`, `src/db/schema.ts`, `src/db/migrar.ts`, `drizzle.config.ts`, `tests/unit/migraciones.test.ts`; Delete `src/db/.gitkeep`; Modify `package.json`, `bun.lock`.

**Interfaces:**
- Consumes: nada de Task 1.
- Produces: `CARPETA_MIGRACIONES: string` (ruta absoluta de `src/db/migrations`); `type EntradaJournal = { tag: string; when: number }`; `leerJournal(carpeta: string): EntradaJournal[]` (`[]` si no existe `meta/_journal.json`); `rutaDown(carpeta: string, tag: string): string` (`<carpeta>/<tag>.down.sql`); `motivoIrreversible(sqlDown: string): string | null` (el motivo si hay una línea `-- IRREVERSIBLE: <motivo>` con motivo no vacío); `verificarReversibilidad(carpeta: string): string[]` (una descripción por problema; vacío si todo está bien); `abrirBase(url: string): { sql: SQL; db: BunSQLDatabase<typeof schema> }`; `migrar(db, carpeta?: string): Promise<number>` (devuelve el número de entradas del journal; `0` y sin tocar la base si no hay journal).

- [ ] **Step 1: Instalar** con `bun add --exact drizzle-orm@0.45.4` y `bun add --dev --exact drizzle-kit@0.31.11`. Comprobar en `package.json` que quedan exactas y que `bun install --frozen-lockfile` pasa.
- [ ] **Step 2: Escribir la prueba que falla** `tests/unit/migraciones.test.ts` (carpetas temporales con `mkdtempSync`):
  - `leerJournal` devuelve `[]` sin journal y las entradas `{ tag, when }` con uno de dos migraciones.
  - `rutaDown(c, "0000_identidad")` termina en `0000_identidad.down.sql`.
  - `motivoIrreversible`: `"-- IRREVERSIBLE: pierde datos"` → `"pierde datos"`; con espacios extra y en medio de otras líneas → el motivo; `"-- IRREVERSIBLE:"`, `"-- IRREVERSIBLE:   "`, `"-- irreversible: x"` y `"DROP TABLE x;"` → `null`.
  - `verificarReversibilidad`: sin journal → `[]`; migración con `down.sql` no vacío → `[]`; migración con solo marcador válido → `[]`; sin archivo `down` → un problema que nombra el tag; `down.sql` vacío o solo comentarios sin marcador → problema; marcador sin motivo → problema.
  - **La carpeta real** `CARPETA_MIGRACIONES` pasa `verificarReversibilidad` (hoy sin migraciones; vigila las futuras).
- [ ] **Step 3: Ejecutar** `bun test ./tests/unit/migraciones.test.ts` → FALLA.
- [ ] **Step 4: Implementar** los módulos: `leerJournal` parsea el JSON del journal; `abrirBase` usa `new SQL(url)` de `"bun"` y `drizzle({ client: sql, schema })` de `drizzle-orm/bun-sql`; `schema.ts` exporta solo `export {}` (la #31 añade el esquema de identidad); `migrar` llama al migrador de `drizzle-orm/bun-sql/migrator` con `migrationsFolder`. `drizzle.config.ts`: `dialect: "postgresql"`, `schema: "./src/db/schema.ts"`, `out: "./src/db/migrations"`, **sin** credenciales. Borrar `src/db/.gitkeep`.
- [ ] **Step 5: Ejecutar** la prueba → pasa; `bun run format`, `lint`, `check` y `bun run test` → verdes.
- [ ] **Step 6: Commit** `feat(h1): instalar Drizzle y añadir la conexión, el journal y el verificador de reversibilidad`.

---

### Task 3: Ejecutor de rollback (con pruebas de integración contra PostgreSQL)

**Files:** Create `src/db/rollback.ts`, `tests/support/base-de-pruebas.ts`, fixtures, `tests/unit/rollback-guardia.test.ts`, `tests/integration/db-rollback.test.ts`.

**Interfaces:**
- Consumes: `asegurarBaseDePruebas`, `GuardiaBaseError` (Task 1); `leerJournal`, `rutaDown`, `motivoIrreversible`, `CARPETA_MIGRACIONES`, `migrar`, `abrirBase` (Task 2).
- Produces: `class RollbackError extends Error`; `revertirUltimaMigracion(sql: SQL, carpeta?: string): Promise<{ tag: string }>`; en `tests/support/base-de-pruebas.ts`: `urlDePruebas(): string | undefined` (lee `TEST_DATABASE_URL`), `abrirBaseDePruebas(): Promise<SQL>` (abre y ejecuta la guardia), `reiniciarEsquema(sql: SQL): Promise<void>` (guardia primero; luego elimina y recrea `public` y elimina `drizzle`).

**Fixtures** (`tests/fixtures/migraciones/<caso>/`, cada una con `meta/_journal.json` en el formato de «Hechos verificados», `when: 1700000000000`, una entrada `0000_prueba`): `reversible/` (`0000_prueba.sql` crea `prueba_h1(id uuid pk default gen_random_uuid(), nombre text not null)`; `.down.sql` hace `DROP TABLE "prueba_h1";`), `irreversible/` (mismo `.sql`; `.down.sql` solo `-- IRREVERSIBLE: ejemplo de migración que pierde datos`) y `down-roto/` (mismo `.sql`; `.down.sql` con `DROP TABLE "prueba_h1";` y luego `DROP TABLE "no_existe_h1";`).

- [ ] **Step 1: Prueba unitaria de la guardia en el ejecutor (falla).** `rollback-guardia.test.ts` con una conexión falsa `SQL` (función etiquetada con `begin` y `unsafe`, que registra cada llamada y responde `current_database()` con `traveltech_private`): `revertirUltimaMigracion(falsa)` rechaza con `GuardiaBaseError`; la única consulta registrada es la de `current_database`; `begin` y `unsafe` **nunca** se invocaron. Repetir con `traveltech_demo`. Ejecutar → FALLA.
- [ ] **Step 2: Pruebas de integración (fallan).** `db-rollback.test.ts` con `describe.skipIf(!urlDePruebas())`, `beforeEach` que ejecuta `reiniciarEsquema`, `afterAll` que cierra la conexión. Casos (usando `abrirBase`/`migrar` sobre la URL de pruebas y cada fixture):
  1. `migrar` sobre `reversible/` crea `public.prueba_h1` y deja **1** fila en `drizzle.__drizzle_migrations`.
  2. **Ciclo:** migrar → revertir devuelve `{ tag: "0000_prueba" }` → `to_regclass('public.prueba_h1')` es `null` y el historial queda en **0** filas → migrar otra vez → la tabla existe y el historial tiene **1** fila.
  3. `irreversible/`: migrar → revertir rechaza con `RollbackError` cuyo mensaje contiene `IRREVERSIBLE` y el motivo; la tabla sigue existiendo y el historial sigue en 1 fila.
  4. `down-roto/`: migrar → revertir rechaza; la tabla `prueba_h1` **sigue existiendo** y el historial sigue en 1 fila (atomicidad).
  5. Sin migraciones aplicadas (tras `reiniciarEsquema`): revertir rechaza con `RollbackError` («No hay migraciones aplicadas»).
  6. Con la carpeta real sin migraciones, `migrar` devuelve `0` y no crea el esquema `drizzle`.
  Ejecutar con la base en marcha (`docker compose up -d --wait`, `.env` con `TEST_DATABASE_URL` descomentada) → FALLAN. Sin `TEST_DATABASE_URL` las pruebas se omiten, no fallan.
- [ ] **Step 3: Implementar `revertirUltimaMigracion`** en este orden: (1) `asegurarBaseDePruebas(sql)`; (2) leer la última fila de `drizzle.__drizzle_migrations` por `id` más alto (si el esquema o la tabla no existen, o no hay filas → `RollbackError` «No hay migraciones aplicadas»); (3) emparejarla con el journal por `Number(created_at) === when` (sin pareja → `RollbackError`); (4) leer `rutaDown` (si no existe → `RollbackError`; si `motivoIrreversible` no es `null` → `RollbackError` con `IRREVERSIBLE` y el motivo); (5) `sql.begin` con `tx.unsafe(textoDown)` y `delete` de **esa** fila por `id`. Los mensajes no incluyen URLs.
- [ ] **Step 4: Ejecutar** unitaria e integración → pasan. Ejecutar también `bun run test` **sin** `TEST_DATABASE_URL` → las de integración con PostgreSQL se omiten y todo sigue en verde.
- [ ] **Step 5:** `bun run format`, `lint`, `check` limpios.
- [ ] **Step 6: Commit** `feat(h1): añadir el ejecutor de rollback con guardia de base de pruebas`.

---

### Task 4: Scripts `db:generate`, `db:migrate` y `db:rollback` y verificación real

**Files:** Create `scripts/db-migrar.ts`, `scripts/db-rollback.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: `parsearObjetivo`, `urlDelObjetivo`, `ObjetivoInvalidoError` (Task 1); `abrirBase`, `migrar` (Task 2); `revertirUltimaMigracion`, `RollbackError`, `GuardiaBaseError` (Task 3); `loadConfig`, `ConfigError` de `src/lib/config.ts`.
- Produces: scripts `db:generate` (`drizzle-kit generate`), `db:migrate` (`bun scripts/db-migrar.ts`), `db:rollback` (`bun scripts/db-rollback.ts`).

- [ ] **Step 1: Implementar `scripts/db-migrar.ts`:** `parsearObjetivo(process.argv.slice(2))` (error → mensaje y salida **2**); `loadConfig(process.env)` (`ConfigError` → su mensaje y salida **1**, como `scripts/start.ts`); abre la base del objetivo, ejecuta `migrar`, cierra la conexión y escribe «Migraciones aplicadas a la base <objetivo>» o, si devolvió `0`, «No hay migraciones que aplicar». Nunca imprime la URL.
- [ ] **Step 2: Implementar `scripts/db-rollback.ts`:** lee `TEST_DATABASE_URL` (ausente → mensaje y salida **2**); abre la conexión, `revertirUltimaMigracion`, cierra siempre; éxito: «Revertida <tag> en la base de pruebas» (salida 0); `GuardiaBaseError`/`RollbackError` → mensaje y salida **1**. No acepta argumentos. Nunca imprime la URL.
- [ ] **Step 3: Añadir los tres scripts** a `package.json`.
- [ ] **Step 4: Verificación real** (`.env` temporal con `AUTH_SECRET` válido y `docker compose up -d --wait`; no tocar bases ajenas): (a) `bun run db:migrate` y `bun run db:migrate demo` → «No hay migraciones que aplicar», salida 0; (b) `bun run db:migrate test`, `bun run db:migrate ../x` y `bun run db:migrate private demo` → salida 2 y mensaje de uso; (c) con `TEST_DATABASE_URL` apuntando a `traveltech_test`, `bun run db:rollback` → «No hay migraciones aplicadas» y salida 1; (d) con `TEST_DATABASE_URL` apuntando a **`traveltech_private`** (solo lectura de `current_database()`; la guardia aborta antes de cualquier SQL), `bun run db:rollback` → salida 1 y mensaje de la guardia, y `traveltech_private` intacta; (e) sin `TEST_DATABASE_URL` → salida 2; (f) `bun run db:generate` sin cambios de esquema → no genera archivos y `git status` limpio. Después `docker compose down -v` y borrar `.env`.
- [ ] **Step 5:** `bun run format`, `lint`, `check`, `test` y `build` con entorno válido → verdes.
- [ ] **Step 6: Commit** `feat(h1): añadir los scripts db:generate, db:migrate y db:rollback`.

---

### Task 5: ADR-023, criterios de H1 y documentación

**Files:** Modify los listados en «Estructura de archivos».

- [ ] **Step 1: ADR-023** en `docs/05-decisiones/11-decisions-and-risks.md` (fila de la tabla y sección con la plantilla): decisiones del responsable (los 8 puntos), el layout `NNNN_<n>.down.sql` + marcador `-- IRREVERSIBLE: <motivo>`, el ejecutor (guardia → última fila → emparejado por `created_at`/`when` → `down` y borrado de la fila en una transacción), solo `traveltech_test`, `db:migrate` con migrador programático de `bun-sql` y por qué (Node no carga `.env`; `pg` solo lo exigía `drizzle-kit migrate`, por lo que **no se instala**; nota de actualización sobre ADR-015), alternativas B y C del diseño, y consecuencias (reversa manual por migración; no hay rollback sobre privada/demo en H1; respaldo y restauración en H8).
- [ ] **Step 2: Roadmap.** En el criterio de salida de H1, sustituir «primera migración y rollback probados» por «primera migración y rollback probados con el ciclo migrar → verificar → revertir → verificar → migrar sobre `traveltech_test` (ADR-023)».
- [ ] **Step 3: Guía de desarrollo.** Tabla de scripts (`db:generate`, `db:migrate`, `db:rollback` con sus códigos de salida y restricciones), «Estructura» (`src/db/` y `drizzle.config.ts`), «Aún no instalados» (Drizzle ya instalado; `pg` **no** se instala y por qué; Better Auth sigue pendiente), cómo escribir un `down.sql` y marcar una migración irreversible, y la nota de que `drizzle-kit` no carga `.env`.
- [ ] **Step 4: Pruebas.** En `10-testing-and-quality.md`, indicar que existe la guardia y `tests/support/base-de-pruebas.ts` y que las pruebas con PostgreSQL se omiten sin `TEST_DATABASE_URL` (el fallo obligatorio en CI llega en la #30).
- [ ] **Step 5: Diseño y estado.** En el diseño de H1 anotar las cuatro llamadas de «Global Constraints» (guardia y soporte movidos a la #29, sin `pg`, `db:generate`, `abrirBase`). Actualizar README (tabla de comandos), `00-estado.md` y `CLAUDE.md` (scripts `db:*` existen; `db:migrate` solo aplica migraciones, aún no hay esquema). `admin:create` y `demo:seed` siguen sin existir.
- [ ] **Step 6: Verificación final y entrega.** `format:check`, `lint`, `check`, `test` y `build` verdes; commit `docs(h1): registrar ADR-023 y documentar Drizzle, migraciones y rollback`; con autorización del responsable, `git push -u origin feat/h1-drizzle-migraciones` y PR hacia `dev` con `Closes #29`; esperar `verificar` y `commits` en verde.

## Autorrevisión
- **Cobertura del diseño (Issue 2):** instalación exacta (Task 2; `pg` omitido con ruling), conexión `bun-sql` con `{ schema }` (Task 2), `drizzle.config.ts` y `db:migrate` con `private`/`demo` (Tasks 2 y 4), layout `down.sql` y marcador irreversible con prueba que exige una u otra (Task 2), ejecutor transaccional sincronizado con el historial y solo `traveltech_test` (Task 3), pruebas del ejecutor (Task 3, con base real y con conexión simulada), ADR-023 y criterios de H1 (Task 5). Verificados antes de planificar: carga de `.env`, tolerancia a archivos extra, formato del historial.
- **Consistencia de nombres:** `asegurarBaseDePruebas`, `GuardiaBaseError`, `BASE_DE_PRUEBAS`, `abrirBase`, `migrar`, `revertirUltimaMigracion`, `RollbackError`, `leerJournal`, `rutaDown`, `motivoIrreversible`, `verificarReversibilidad`, `CARPETA_MIGRACIONES` son los mismos en todas las tareas y los que usarán la #30 y la #31.
- **Fuera de alcance de esta issue:** esquema de identidad y primera migración real (#31); `skipIf` con fallo en CI y servicio PostgreSQL de CI (#30).
