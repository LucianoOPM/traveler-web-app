# H1, issues 1 a 4 — Base de datos, migraciones reversibles y esquema de identidad (diseño)

**Aprobado por el responsable en la conversación (2026-11-22)**, con las llamadas del constructor confirmadas: `db:rollback` solo sobre `traveltech_test` (sin flexibilizar), `POSTGRES_PASSWORD` y `TEST_DATABASE_URL` fuera de `loadConfig`, CI que **falla** si falta `TEST_DATABASE_URL` o PostgreSQL, `db:migrate` sobre `private` (por defecto) o `demo`, nombres de tablas por defecto de Better Auth y pruebas en serie. Si Better Auth 1.7.27 no admite UUID, o Drizzle difiere de forma importante de lo previsto, se detiene esa parte y se consulta. Issues de GitHub: #28 (Docker Compose), #29 (Drizzle y rollback), #30 (PEN-15 y CI), #31 (identidad). Tamaño: proyecto (cuatro issues encadenadas).

> Nota: el diseño decía que la CI «falla si existe la variable `CI` y falta `TEST_DATABASE_URL`»; el responsable amplía el criterio: también debe fallar si PostgreSQL no está disponible.

## Intención
Dejar lista la base de datos sobre la que se construirá todo H1: PostgreSQL local reproducible, Drizzle con migraciones **reversibles y probadas**, una estrategia de pruebas con PostgreSQL que **no pueda destruir** la base privada ni la demo (PEN-15, criterio de salida de H1) y la primera migración, la de identidad (Better Auth + Admin plugin). Las issues 5 en adelante (`admin:create`, handler de auth, rutas protegidas, layout, login) quedan fuera de este documento.

## Metas
- `docker compose up -d` deja PostgreSQL con las bases `traveltech_private`, `traveltech_demo` y `traveltech_test`, con volumen persistente.
- `bun run db:migrate` aplica las migraciones a la base elegida **en el servidor** (nunca por parámetro del cliente).
- Cada migración reversible tiene su `down.sql` versionado junto a ella; las irreversibles se declaran como tales.
- Una prueba automatizada ejecuta en `traveltech_test`: migrar → verificar esquema → revertir → verificar reversión → migrar de nuevo.
- Toda operación destructiva de pruebas o de rollback comprueba `SELECT current_database()` y exige `traveltech_test`.
- La CI ejecuta esas pruebas con un PostgreSQL real.
- Esquema de identidad con UUID y fechas con zona, sin `organization_id` (ADR-001).

## No metas
Sistema de respaldo y restauración (H8). Administrador inicial, handler `/api/auth/*`, sesión en el middleware, rutas protegidas, login y layout (issues 5 a 10). Tablas de negocio. Aislamiento por transacciones o conexiones separadas para pruebas de concurrencia (H3). Tabla `audit_events` y *readiness* en `/api/health` (siguen **no decididos**). Conexión de la aplicación a la base demo (H7): en H1 solo se migra, no se usa.

## Anti-metas
Que una prueba, un script o un `.env` mal configurado pueda borrar o migrar hacia atrás `traveltech_private` o `traveltech_demo`; ejecutar rollbacks destructivos de forma automática fuera de `traveltech_test`; que las pruebas con PostgreSQL rompan `bun run test` en una máquina sin base de datos; tecnologías no confirmadas en ADR-015.

## Decisiones del responsable (confirmadas, 2026-11-22)
1. Rollback mediante **scripts SQL `down` escritos a mano**, un `down.sql` por migración, versionado con ella.
2. «Rollback probado» = revertir una migración estructural y comprobar que el esquema puede volver a aplicarse.
3. La primera migración (identidad) debe poder crear y eliminar sus tablas, índices y restricciones.
4. Ciclo de prueba en `traveltech_test`: migrar → verificar → revertir → verificar → migrar.
5. Antes de cualquier operación destructiva: `SELECT current_database()` y comprobar que es `traveltech_test`. Nunca rollback destructivo automático en `traveltech_private` ni `traveltech_demo`.
6. Migraciones con pérdida o transformación irreversible de datos: se declaran irreversibles; respaldo/restauración o migración correctiva según el caso.
7. Respaldo y restauración completos quedan para H8.
8. Registrar la decisión en un ADR y actualizar los criterios de aceptación de H1.

## Enfoques considerados
- **A. `down.sql` manual por migración (elegido por el responsable).** Simple, versionado, verificable. Coste: escribir y mantener la reversa a mano.
- B. Solo respaldo y restauración. Cubre datos, pero es lento, no prueba el esquema migración a migración y necesita infraestructura que se pospone a H8.
- C. Migraciones correctivas hacia adelante únicamente. Es lo habitual en producción, pero no cumple el criterio de salida «rollback probado».

> **Cambios aprobados al empezar la issue #29 (2026-11-22):** (1) ~~no se instala `pg`~~ **revisado en el mismo PR:** `db:migrate` es `drizzle-kit migrate` (el flujo oficial de la documentación de Drizzle) y `pg` 8.23.1 se instala como devDependency, como preveía ADR-015; `db:migrate:demo` usa `drizzle.demo.config.ts`; `migrate()` de `bun-sql` se usa solo en las pruebas (la premisa de que `drizzle-kit` no carga `.env` era falsa); se eliminan `scripts/db-migrar.ts`, `src/db/objetivo.ts` y `src/db/migrar.ts`; (2) la **guardia** `asegurarBaseDePruebas` y el soporte mínimo de pruebas (`tests/support/base-de-pruebas.ts`) se crean en la #29, porque el ejecutor de rollback y su prueba los necesitan; la #30 conserva el fallo obligatorio en CI, el servicio PostgreSQL de CI, el ADR-024 y la documentación; (3) se añade el script `db:generate`; (4) la conexión es `abrirBase(url)` sin *singleton* (`getConfig()` usa `astro:env/server`, inexistente en scripts). El ejecutor además verifica el SHA-256 del `.sql` contra el historial antes de revertir. Plan: `docs/superpowers/plans/2026-11-22-issue-29-drizzle-migraciones.md`; registro: ADR-023.

## Diseño por issue

### Issue 1 — Docker Compose con PostgreSQL y las tres bases
- `docker-compose.yml` con un único servicio `postgres`: imagen con **etiqueta exacta** (la de ADR-015, `17.10` sobre `alpine`; se verifica que exista al implementar), volumen con nombre, puerto publicado solo en `127.0.0.1:5432` y `healthcheck` con `pg_isready`.
- Script de inicialización en `docker/postgres/init/` que crea `traveltech_private`, `traveltech_demo` y `traveltech_test`. Solo se ejecuta cuando el volumen está vacío; se documenta cómo recrearlo (`docker compose down -v`, que destruye los datos locales).
- *Llamada del constructor:* la contraseña llega al contenedor por una variable `POSTGRES_PASSWORD` del `.env` (solo para Compose, fuera de las 8 variables de `loadConfig`); el `.env.example` la incluye con el mismo marcador `CHANGE_ME` y la guía avisa de que debe coincidir con la de las URLs.
- *Llamada del constructor:* se añade `TEST_DATABASE_URL` a `.env.example` como variable **opcional** (no entra en `loadConfig`; PEN-15 la quiere fuera de las obligatorias).
- Se documenta en la guía de desarrollo y el README; se retira la nota «todavía NO existe» de `docker compose up -d`.
- Prueba: verificación manual documentada (`docker compose up -d`, tres bases presentes con `psql`) más, en la issue 3, la prueba contra la base real. No se añade prueba automatizada de Docker.

### Issue 2 — Drizzle, conexión y `db:migrate`
- Instalar con versión exacta (ADR-015): `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11 y `pg` 8.23.1 (esta última solo devDependency para `drizzle-kit`).
- `src/db/`: conexión con `drizzle-orm/bun-sql` pasando `{ schema }`, esquema agregado (vacío hasta la issue 4) y carpeta `migrations/`. La URL sale de `getConfig()` (servidor); no se lee `import.meta.env`.
- `drizzle.config.ts` y script `db:migrate`. *Llamada del constructor:* el script acepta `private` (por defecto) o `demo` como argumento de línea de comandos de un administrador local, nunca desde una petición; ambas reciben las mismas migraciones (REC-001). Aplicar a `traveltech_test` queda reservado a las pruebas.
- **Layout de la reversa:** `NNNN_nombre.sql` (generado por Drizzle) junto a `NNNN_nombre.down.sql`. *Verificar al implementar* que `drizzle-kit migrate` ignora los archivos extra y cómo carga el `.env` bajo Node (ADR-017: Node no lo carga solo).
- **Migraciones irreversibles:** su `.down.sql` contiene un marcador `-- IRREVERSIBLE: <motivo>`; el ejecutor de rollback se niega a correrlas. Una prueba falla si una migración no tiene `.down.sql` ni el marcador, para que no se olvide ninguna.
- **Ejecutor de rollback** (módulo en `src/db/` más script `db:rollback`): aplica el `.down.sql` de la última migración **dentro de una transacción** y elimina su fila de `drizzle.__drizzle_migrations`, de modo que `migrate` pueda volver a aplicarla (*verificar al implementar* el formato exacto de esa tabla en 0.31.11). *Llamada del constructor:* en H1 el script **solo opera sobre `traveltech_test`** y se niega en cualquier otra base; revertir una base de desarrollo se hace a mano con el `.down.sql`, tras un respaldo propio. Se puede relajar más adelante con un ADR.
- Pruebas unitarias del ejecutor con una conexión simulada (orden, transacción, rechazo de irreversibles).

### Issue 3 — Estrategia de pruebas con PostgreSQL y protección (PEN-15)
- **Guardia** en `src/db/`: `asegurarBaseDePruebas(consulta)` ejecuta `SELECT current_database()` **en la propia conexión** y lanza error si el resultado no es exactamente `traveltech_test`. No compara URLs. Toda limpieza, migración o rollback de pruebas la invoca antes de la primera operación destructiva. Pruebas unitarias con una conexión simulada que devuelve `traveltech_private`, `traveltech_demo`, `postgres`, vacío y un error de consulta (todos deben rechazarse); y una de integración con la base real.
- **Soporte de pruebas** en `tests/support/`: lee `TEST_DATABASE_URL`, abre la conexión, ejecuta la guardia y expone el restablecimiento del esquema de pruebas (eliminar `public` y `drizzle` y recrear), siempre detrás de la guardia.
- **Omisión:** las pruebas con PostgreSQL usan `describe.skipIf` cuando no hay `TEST_DATABASE_URL`, de modo que `bun run test` sigue pasando sin base de datos. *Llamada del constructor:* si existe la variable de entorno `CI`, la ausencia de `TEST_DATABASE_URL` **hace fallar** en lugar de omitir, para que la CI no pase en silencio sin ejecutarlas.
- **Aislamiento en H1:** los archivos con base de datos se ejecutan en serie (comportamiento por defecto de `bun test`); no se usa `--parallel` ni `--concurrent`. Se documenta la limitación y que las pruebas de concurrencia (INV-01, BRD-01) y su estrategia de conexiones separadas llegan con H3.
- **CI:** el job `verificar` añade un servicio PostgreSQL con la misma etiqueta exacta, con `traveltech_test` creada, y `TEST_DATABASE_URL`. Los nombres de los jobs no cambian (son checks requeridos).
- ADR nuevo que resuelve PEN-15 y se borra de `pendientes.md`.

### Issue 4 — Esquema de identidad y primera migración con rollback
- Instalar `better-auth` y `@better-auth/drizzle-adapter` 1.7.27 y el CLI `auth` 1.7.27 (devDependency).
- Módulo `identity`: configuración mínima de Better Auth con el Admin plugin y los roles `admin` y `operator`, **solo la necesaria para generar el esquema**; no se monta el handler (issue 6). Los permisos finos de negocio no van en Better Auth (doc 06).
- Esquema generado con `auth generate` y revisado a mano: identificadores **UUID** y fechas `timestamptz` (convención del proyecto). *Verificar al implementar* cómo lo admite Better Auth 1.7.27; si no se puede cumplir la convención, se detiene el trabajo y se consulta antes de decidir.
- Se conservan los nombres de tablas por defecto de Better Auth (`user`, `session`, `account`, `verification`) para no depender de mapeos del adaptador. *Llamada del constructor.*
- Primera migración `0000_identidad` con su `down.sql` (elimina tablas, que arrastran sus índices y restricciones, en orden inverso de dependencias).
- **Prueba de ciclo** (`tests/integration/`): en `traveltech_test`, restablecer → migrar → verificar tablas, columnas (`id` de tipo `uuid`), índices, claves foráneas y unicidad del correo → revertir → verificar que no queda tabla ni fila en `drizzle.__drizzle_migrations` → migrar de nuevo → verificar que el esquema es idéntico al del primer paso.
- `db:migrate` aplicado a `private` y `demo` en la verificación manual de cierre.
- No se crean usuarios ni sesiones; el rol por defecto del plugin se decide en la issue 6.

## Dependencias y orden
Issue 1 → 2 → 3 → 4. La 3 necesita la conexión y el ejecutor de la 2; la 4 necesita la guardia y la base de pruebas de la 3 y el ejecutor de rollback de la 2.

## Documentación (se reparte entre las issues)
ADR-023: estrategia de rollback con `down.sql` (decisiones del responsable). ADR-024: estrategia de PostgreSQL para pruebas (cierra PEN-15). Actualizar el criterio de salida de H1 en el roadmap, `00-estado.md`, `09-development-guide.md` (nuevos scripts y variables), `10-testing-and-quality.md` (de «propuesta» a implementada) y la nota de `/api/health` si procede. Retirar los `.gitkeep` de `src/db/` y `src/modules/identity/` al recibir su primer archivo.

## Verificación de la fase
`bun run format:check`, `lint`, `check`, `test` (con y sin `TEST_DATABASE_URL`), `build`; ciclo migrar/revertir/migrar en `traveltech_test`; CI en verde en el PR; verificación manual de `docker compose up -d` y de `db:migrate` en clon limpio.

## A cargo del constructor
Texto de los mensajes y de las pruebas, nombre exacto de los archivos de Compose y de inicialización, detalles de `drizzle.config.ts` una vez verificada la carga del `.env` bajo Node, y qué filas de documentación tocar.
