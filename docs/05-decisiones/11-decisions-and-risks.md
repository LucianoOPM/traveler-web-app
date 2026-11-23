# 11 — Registro de decisiones y riesgos

Los **pendientes** viven en [pendientes.md](pendientes.md). Las **cifras del seed** viven solo en [08-demo-seed-and-content](../03-demo/08-demo-seed-and-content.md).

## Decisiones confirmadas (ADR resumidos)
| ID | Decisión | Estado |
|---|---|---|
| ADR-001 | Una agencia, no multitenencia | Confirmada |
| ADR-002 | Astro + React islands + Bun | Confirmada |
| ADR-003 | PostgreSQL + Drizzle; Docker solo para BD | Confirmada |
| ADR-004 | Better Auth + Admin plugin para personal | Confirmada |
| ADR-005 | Monolito modular | Confirmada |
| ADR-006 | Archivos locales para fase demo | Confirmada |
| ADR-007 | Invitación un uso/24 h; sesión 2 h; watermark único | Confirmada |
| ADR-008 | Formularios visitante interactivos sin persistencia; acciones mixtas | Confirmada |
| ADR-009 | Seed PostgreSQL con fechas relativas a T0 | Confirmada |
| ADR-010 | Volumen del seed: paquetes, salidas, reservas y flyers (cifras en doc 08) | Confirmada |
| ADR-011 | Distribución de estados de reservas (cifras en doc 08) | Confirmada |
| ADR-012 | Salidas en abordaje y finalizadas (cifras en doc 08) | Confirmada |
| ADR-013 | Pagos variados y 3 cuentas ficticias con excepciones | Confirmada |
| ADR-014 | QR de visitante consultable, solo lectura | Confirmada |
| ADR-015 | Versiones del stack (Bun 1.4.4, Astro 7.4.13, React 19.3.1, Drizzle 0.45.4, Better Auth 1.7.27; paquetes exactos) y driver `bun-sql` | Confirmada |
| ADR-016 | Estrategia de ramas: `main` = despliegue, `dev` = desarrollo (predeterminada) | Confirmada |
| ADR-017 | Validación de configuración con una función propia (`comprobarConfiguracion`) que corre al iniciar dev, build y start | Confirmada |
| ADR-018 | Formato con Prettier y lint con ESLint 10 (plugin Astro, accesibilidad `recommended`); typescript-eslint limita TypeScript a `<6.1.0` | Confirmada |
| ADR-019 | Errores tipados (`AppError` y 7 clases), respuesta `{ error: { code, message } }`, captura en el middleware de `/api/` y registro controlado de inesperados | Confirmada |
| ADR-020 | Runner de pruebas `bun test` con scripts `test`, `test:unit` y `test:integration` | Confirmada |
| ADR-021 | Conventional Commits solo como recomendación (sin hook ni validación en CI) | Confirmada |
| ADR-022 | CI en GitHub Actions: un workflow con el job `verificar` (formato, lint, tipos, pruebas y build) | Confirmada |
| ADR-023 | Migraciones reversibles con `down.sql` manual, rollback solo en `traveltech_test` con guardia `current_database()`, `drizzle-kit generate/migrate` oficiales (con `pg`) y nota sobre relaciones de Drizzle 1.0 | Confirmada |

### ADR-015 — Versiones del stack y driver de PostgreSQL
> Actualización (ADR-023, issue #29): `pg` 8.23.1 **sí se instala** como devDependency (la exige `drizzle-kit migrate`, que es el `db:migrate` oficial); la aplicación sigue usando `drizzle-orm/bun-sql`.

Estado: confirmada
Contexto: PEN-11 bloqueaba H0 (no se podía fijar `package.json`). La documentación de Context7 iba por detrás del registro (indicaba Astro 6 y que `bun-sql` solo existía en Drizzle RC), por lo que las versiones se tomaron del registro npm y se probaron juntas.
Decisión: fijar exactas Bun 1.4.4, Astro 7.4.13, @astrojs/node 11.1.14, @astrojs/react 7.1.9, React y react-dom 19.3.1, drizzle-orm 0.45.4, drizzle-kit 0.31.11, better-auth y @better-auth/drizzle-adapter 1.7.27. Servidor ejecutado con Bun; driver de la aplicación `drizzle-orm/bun-sql`; `pg` 8.23.1 como devDependency solo para `drizzle-kit` (verificado: sin `pg`, `drizzle-kit migrate` falla con "please install either of 'pg', 'postgres'..." tanto con Node como con `--bun`); CLI `auth` 1.7.27 como devDependency para generar el esquema de Better Auth. Node >= 22.23.4 (requisito `engines` de Astro; solo se validó con v24.22.0) y PostgreSQL 17.10 (`postgres:17-alpine` al validar; fijar la etiqueta exacta al crear el `docker-compose`). Tabla completa en [09-development-guide](../04-ingenieria/09-development-guide.md).
Validación (proyecto desechable, PostgreSQL 17 en Docker): instalación sin advertencias de peers; `astro build` con island React y adaptador Node; servidor responde 200 en Bun y Node; `drizzle-kit generate/migrate` con el esquema de Better Auth + plugin `admin`; registro por `/api/auth/sign-up/email` correcto con `node-postgres` (Bun y Node) y con `bun-sql` (Bun).
Alternativas consideradas: Node + `pg` y Bun + `pg` (también pasaron la prueba; descartadas por coherencia con ADR-002 y porque el driver nativo de Bun evita `pg` en tiempo de ejecución, aunque `pg` sigue siendo necesario para `drizzle-kit`); Drizzle 1.0 RC (soportado por Better Auth pero pre-release y no probado).
Consecuencias: actualizar versiones requiere repetir la validación y un nuevo ADR; el esquema generado por `auth generate` debe pasarse a `drizzle()`; el comportamiento de `bun-sql` bajo carga y transacciones concurrentes (reservas atómicas, P0) debe cubrirse con pruebas en H3.
Actualización (issue #2, 2026-11-22): se añaden `typescript` **6.0.3**, `@astrojs/check` **0.9.12** (devDependencies, `astro check`) y `@types/react` / `@types/react-dom` **19.3.0**. No se usa `typescript` 7.x (latest) porque `@astrojs/check` 0.9.12 exige `typescript ^5 || ^6`. Verificado desde un clon limpio: `bun install --frozen-lockfile`, `astro check`, `dev` (Node y `bun --bun`), `build` y `preview` correctos.
Fecha: 2026-11-22

### ADR-016 — Estrategia de ramas
Estado: confirmada
Contexto: se quiere separar el código en desarrollo del que se despliega.
Decisión: `main` es la rama de despliegue y `dev` la rama predeterminada de desarrollo. Las ramas de trabajo (`feat/`, `fix/`, `chore/`, `docs/`) salen de `dev` y vuelven a ella por PR. `dev` se fusiona a `main` por PR cuando un hito esté listo o se vaya a desplegar, con *merge commit* (no *squash*) para que no diverjan. Los hotfix salen de `main` y se devuelven a `dev`. Protección de `dev` y `main` (rulesets de GitHub): exigir PR, **sin aprobaciones obligatorias**, y bloquear force-push y borrado; sin checks de CI obligatorios hasta que exista la CI (issue #10); desde la issue #10 se exigen `verificar` y `commits` (ver Consecuencias).
Alternativas consideradas: trabajo directo sobre `main`; exigir aprobación en `main` (descartado: un único responsable no puede aprobar sus propios PR).
Consecuencias: `Closes #N` solo cierra issues al fusionar en `dev` (la predeterminada); al fusionar `dev` → `main` hay que cerrar a mano las que queden abiertas. Cuando exista CI, añadirla como check requerido: la CI existe desde la issue #10 ([ADR-022](#adr-022--ci-en-github-actions)) con los checks `verificar` y `commits`. Tras comprobar ambos en el PR #22, el responsable aprobó exigirlos y se añadió la regla `required_status_checks` a `proteger-dev` y `proteger-main` (2026-11-22), sin exigir que la rama esté actualizada con la base y sin cambiar el resto de reglas. El despliegue desde `main` depende de PEN-08.
Fecha: 2026-11-22

### ADR-017 — Validación de configuración de entorno
Estado: confirmada (simplificada el 2026-11-22)
Contexto: la aplicación no debe arrancar con configuración inválida ni filtrar secretos al cliente, a logs o al build (`import.meta.env.X` incrusta el valor del `.env` en `dist/`).
Decisión: una función `comprobarConfiguracion(env)` en `src/lib/config.ts` (sin Zod, sin objeto `Config`, sin caché) llamada desde `astro.config.mjs` (dev y build) y `scripts/start.ts` (producción, antes de escuchar). Las variables se leen con `process.env`.
Alternativas descartadas: `env.schema` de Astro — se probó el 2026-11-22: con `validateSecrets: true` un build sin `DATABASE_URL` o con `AUTH_SECRET` corto termina con código 0 y el servidor arranca sin validar, además de no expresar reglas entre variables; validar solo en el middleware (arrancaría con configuración inválida).
Consecuencias: `bun run dev` y `bun run build` exigen un `.env` válido; `.env.example` falla a propósito hasta generar `AUTH_SECRET`. Esto no resuelve PEN-10 (validación de la API).
Fecha: 2026-11-22

### ADR-018 — Formato, lint y accesibilidad estática
Estado: confirmada
Contexto: la issue #5 pide formateador y linter compatibles con Astro, React y TypeScript, accesibilidad básica en JSX y base para la CI (issue #10). El responsable pidió registrarlo como "ADR-015"; ese número ya existe (versiones del stack), y el 016 y el 017 también, por lo que se usa el siguiente libre.
Decisión: Prettier 3.10.1 + prettier-plugin-astro 1.1.2 (formato) y ESLint 10.15.0 (flat config) + typescript-eslint 8.73.0 + eslint-plugin-astro 3.2.1 + eslint-plugin-jsx-a11y-x 0.2.0 (lint y accesibilidad nivel `recommended` en plantillas Astro y en `.tsx`). Se añaden, justificados, `@eslint/js` 10.0.1 y `globals` 17.14.0 (ESLint no los instala: reglas base y globales de Node/navegador). Todo exacto, sin `^`. Scripts `format`, `format:check` y `lint` (`--max-warnings 0`). `printWidth` 100 y `endOfLine: "lf"` con `.gitattributes` (`* text=auto eol=lf`); `docs/`, `*.md` y `bun.lock` fuera del formato. El campo `engines` de Node pasa a `^22.23.4 || ^24.16.0 || >=26.3.0` (intersección de Astro, ESLint y `eslint-plugin-astro`). Reglas no type-aware; sin desactivar reglas globalmente (excepciones puntuales con motivo).
Verificado: con temporales, `lint` detecta `label` sin control y `img` sin `alt` en `.tsx` y en `.astro` y una directiva `eslint-disable` sin uso; un warning hace fallar con `--max-warnings 0`; en un `git clone` real con `core.autocrlf=true`, el checkout queda en LF (0 archivos CRLF), `bun install --frozen-lockfile` no cambia el lockfile y `format:check` y `lint` salen con 0, y un archivo CRLF commiteado lo detecta `format:check` (antes, con `endOfLine: "auto"` y sin `.gitattributes`, un colaborador con `core.autocrlf=false` podía commitear CRLF sin aviso). Tras la revisión independiente se corrigió que el frontmatter de `.astro` no recibía las reglas base ni de TypeScript (un frontmatter con `any`, `debugger` y variables sin usar salía con 0): se verificó en rojo y en verde. El lint halló un caso real (`preserve-caught-error` en `astro.config.mjs`), corregido con `cause`, sin filtrar valores.
Alternativas consideradas: Biome (en `.astro` solo cubre el frontmatter, soporte experimental); ESLint 9 + `eslint-plugin-jsx-a11y` clásico 6.10.2 (compatible, pero versiones mayores anteriores que habría que migrar); `eslint-config-prettier` (no hace falta: no hay reglas estilísticas activas).
Consecuencias: **`typescript-eslint` 8.73.0 admite TypeScript `>=4.8.4 <6.1.0`; nuestra versión 6.0.3 es compatible, pero cualquier subida a TypeScript 6.1 o superior debe verificar primero la compatibilidad.** `eslint-plugin-jsx-a11y-x` es una versión 0.x (riesgo de cambios). La accesibilidad estática no garantiza que cada `<input>` tenga nombre accesible: los controles de formulario sin nombre accesible o con `for`/`htmlFor` a un `id` inexistente no se detectan estáticamente; se requieren pruebas E2E con axe, **aún sin planificar ni asignar a ninguna issue** (PEN-13). Node: `eslint-plugin-astro` exige `^22.22.3 || ^24.16.0 || >=26.3.0`; la CI debe usar una versión compatible. El formato inicial tocó solo `astro.config.mjs` y `src/lib/config.ts`.
Fecha: 2026-11-22

### ADR-019 — Errores tipados y respuestas uniformes
Estado: confirmada (simplificada el 2026-11-22)
Decisión: `src/lib/errors.ts` define `AppError` y siete subclases (400, 401, 403, 404, 409, 422, 500) con código `snake_case`. `src/middleware.ts` envuelve `next()` en un `try/catch` (en un middleware de Astro `next()` rechaza con el valor lanzado original) y, solo para rutas `/api/`, `toErrorResponse` (`src/lib/error-response.ts`) devuelve `{ error: { code, message } }`. `InternalError` y cualquier otro valor lanzado son inesperados: `500 internal_error` con mensaje genérico y una línea de registro con `errorName`, `method` y `path` (nunca mensaje, `cause`, query ni cabeceras; en desarrollo se imprime el error completo).
Consecuencias: el `message` de un `AppError` es público y su autor responde de que sea seguro; los `404`/`405` de rutas `/api/` inexistentes siguen con el formato de Astro; no hay `requestId` ni biblioteca de logging; 429 queda reservado. Límite: un error lanzado tras empezar una respuesta en streaming no lo captura el middleware.
Fecha: 2026-11-22

### ADR-020 — Runner de pruebas: `bun test`
Estado: confirmada
Contexto: la issue #7 pide elegir el runner de pruebas unitarias (compatible con Bun), dejar las carpetas `tests/unit`, `tests/integration` y `tests/e2e`, los scripts `test` y `test:unit`, y documentar la integración con PostgreSQL y E2E.
Decisión: `bun test` como runner oficial, sin dependencias nuevas, sin `bunfig.toml` y sin umbrales de cobertura. Scripts `test:unit` (`bun test ./tests/unit`), `test:integration` (`bun test ./tests/integration`) y `test` (ambos en secuencia). El `./` es necesario: sin él, el argumento de `bun test` es un filtro por subcadena y recoge rutas ajenas (se comprobó con archivos señuelo: `bun test tests/unit` ejecutaba 43 pruebas en 6 archivos en lugar de 40 en 3). Hechos verificados: `bun test` descubre y ejecuta hoy 49 pruebas (40 unitarias en ~0,1 s y 9 de integración en ~4 s en caliente) sin configuración; por defecto ejecuta los archivos en serie (`--parallel`, `--concurrent` y `--isolate` son opcionales); en un clon limpio, sin `.env`, con el entorno saneado y sin PostgreSQL, `bun run test`, `lint` y `format:check` pasan.
Alternativas consideradas: Vitest (el que documenta Astro, con `getViteConfig()`; añade dependencias y configuración y hoy ningún código lo exige); Jest (más pesado y exige transformar TypeScript); `node:test` (correcto técnicamente, pero el proyecto ejecuta todo con Bun, ADR-002, y daría un segundo runner sin ventaja clara). Ninguna alternativa se probó en este proyecto.
Consecuencias: las pruebas quedan acopladas al runtime Bun (coherente con ADR-002); los módulos virtuales `astro:*` no se pueden importar en `bun test`, por eso la prueba de integración usa el proyecto de `tests/fixtures/api-errors/`; si algún día hace falta probar código que importe `astro:*` sin fixture, reconsiderar Vitest con `getViteConfig()` (no se probó). La estrategia de PostgreSQL para H1 queda como propuesta (PEN-15) y la herramienta E2E como pendiente (PEN-13); no se instaló nada de ello. Deuda conocida de la prueba de integración (carrera mínima del puerto libre y `sleep`) sin tocar.
Fecha: 2026-11-22

### ADR-021 — Conventional Commits como recomendación
Estado: confirmada (reemplaza la versión del 2026-11-22 con validador, hook e instalador)
Decisión: se mantiene la convención `tipo(scope): descripción` como recomendación. No hay hook local, script validador ni job de CI. Motivo: más de 400 líneas de código propio y 70 pruebas para vigilar el formato de los mensajes no justifican su costo en una demo con pocos colaboradores.
Consecuencias: el formato no se impone; si el historial se vuelve inconsistente o se necesitan changelogs automáticos, reconsiderar commitlint.
Fecha: 2026-11-22

### ADR-022 — CI en GitHub Actions
Estado: confirmada (simplificada el 2026-11-22)
Decisión: un workflow, `.github/workflows/ci.yml`, con el job `verificar`: `bun install --frozen-lockfile`, `format:check`, `lint`, `check`, `test` y `build` (con variables ficticias válidas). Se ejecuta en PR hacia `dev` y `main` y en push a ambas, con permisos `contents: read` y sin secretos; `verificar` es check requerido en los rulesets de `dev` y `main`. Se retiró el job `commits` (ADR-021).
Límites: las acciones usan la etiqueta mayor (`@v7`, `@v6`, `@v2`); fijarlas por SHA es una mejora de seguridad posterior.
Fecha: 2026-11-22

### ADR-023 — Migraciones reversibles con `down.sql` y rollback solo en `traveltech_test`
Estado: confirmada
Contexto: el criterio de salida de H1 exige «primera migración y rollback probados». Drizzle (`drizzle-kit`) genera migraciones hacia adelante y no tiene migraciones de reversa. Hay que decidir cómo se revierte, cómo se aplica y qué garantías evitan que una reversión destruya datos de la base privada o de la demo.
Decisión (confirmada por el responsable, 2026-11-22):
1. **Reversa manual:** cada migración reversible tiene `NNNN_<nombre>.down.sql` junto a `NNNN_<nombre>.sql`, versionado con ella. Drizzle lo ignora (verificado).
2. **«Rollback probado»** = revertir una migración estructural y comprobar que el esquema puede volver a aplicarse: ciclo migrar → verificar → revertir → verificar → migrar sobre `traveltech_test`.
3. **Irreversibles:** una migración con pérdida o transformación irreversible de datos se declara con una línea `-- IRREVERSIBLE: <motivo>` (motivo no vacío) en su `down.sql`; el ejecutor se niega a revertirla (respaldo/restauración o migración correctiva, según el caso). Una prueba exige que toda migración tenga `down.sql` con SQL o ese marcador (`verificarReversibilidad`).
4. **Solo `traveltech_test`:** `db:rollback` y las operaciones destructivas de pruebas ejecutan primero `select current_database()` **en la propia conexión** (`asegurarBaseDePruebas`) y exigen exactamente `traveltech_test`; comparar URLs es frágil. Nunca hay rollback automático en `traveltech_private` ni `traveltech_demo`; en otras bases la reversión es manual y con respaldo previo.
5. **Ejecutor** (`revertirUltimaMigracion`): guardia → última fila de `drizzle.__drizzle_migrations` (por `id`) → emparejada con el journal por `created_at` = `when` → el SHA-256 del `.sql` debe coincidir con el `hash` registrado (la migración elegida es realmente la aplicada) → `down.sql` no irreversible → en **una transacción**, el SQL de reversa y el borrado de **esa** fila. Si el SQL falla no cambia nada (verificado con una prueba que falla si se quita la transacción). Tras borrar la fila, `migrate` vuelve a aplicar la migración.
6. **Generar y aplicar con el CLI oficial de Drizzle** (flujo *codebase first* de su documentación): `db:generate` = `drizzle-kit generate` y `db:migrate` = `drizzle-kit migrate`. `drizzle-kit migrate` necesita el driver **`pg`** (sin él falla con «please install either of 'pg', 'postgres'…»), por lo que `pg` 8.23.1 se instala como devDependency, tal como preveía ADR-015. `bun run` carga el `.env` y `drizzle-kit` lo recibe (verificado con un `.env` real). *Corrección:* una primera versión de esta decisión aplicaba las migraciones con un script propio basado en el migrador programático y no instalaba `pg`, justificándolo con que `drizzle-kit` «no carga `.env`»; esa premisa era falsa (el experimento no tenía `.env`) y se revirtió en el mismo PR. `migrate()` de `drizzle-orm/bun-sql/migrator` se usa **solo en las pruebas**, la forma que la documentación indica para verificar migraciones.
7. **Bases:** `db:migrate` usa `drizzle.config.ts` (`DATABASE_URL`, base privada) y `db:migrate:demo` usa `drizzle.demo.config.ts` (`DEMO_DATABASE_URL`, misma carpeta de migraciones y mismo esquema, REC-001); la demo solo recibe migraciones en H1 (uso funcional en H7). Ningún script de migración apunta a `traveltech_test`: la usan las pruebas y `db:rollback`. `drizzle-kit` valida lo que recibe del entorno, no `loadConfig`.
8. Respaldo y restauración completos quedan para H8.
9. **Drizzle hace siempre las migraciones; Better Auth nunca** (regla del responsable, 2026-11-22). El `migrate` del CLI de Better Auth no se usa: según su documentación solo funciona con su adaptador Kysely integrado y, con Drizzle, indica generar el esquema y aplicarlo con la herramienta de migraciones del ORM. A lo sumo, `auth generate` se usa para obtener el esquema de Drizzle del módulo `identity`; ese archivo se revisa, se versiona y es nuestro, y la migración la genera `drizzle-kit generate` (con su `down.sql`) y la aplica `drizzle-kit migrate`. Ninguna configuración de Better Auth debe crear ni alterar tablas por su cuenta. Lo vigila `tests/unit/migraciones-solo-drizzle.test.ts` (ningún script de `package.json` puede ejecutar `auth migrate`).
Verificado (PostgreSQL 17, Docker): ciclo migrar → revertir → migrar con el historial en 1 → 0 → 1 filas; `down` roto a mitad sin cambios; migración irreversible rechazada; `.sql` alterado rechazado; la guardia rechaza `traveltech_private`, `traveltech_demo`, `postgres`, `traveltech_test_2` y `Traveltech_Test`, y `db:rollback` con la URL de la privada o la demo sale con 1 sin ejecutar nada más.
Alternativas consideradas: solo respaldo y restauración (no prueba el esquema migración a migración y necesita infraestructura de H8); solo migraciones correctivas hacia adelante (habitual en producción, pero no cumple «rollback probado»); migrador programático propio como `db:migrate` (descartada tras la revisión: duplica lo que ofrece `drizzle-kit migrate` y su justificación era errónea).
Consecuencias: **versión y relaciones.** Se usa la línea estable `latest` de npm (`drizzle-orm` 0.45.4 y `drizzle-kit` 0.31.11; no existe una etiqueta LTS y 1.0 sigue en beta/RC: `1.0.0-rc.6` el 2026-11-22). La documentación de 1.0 indica que **cambian las relaciones**: 0.45.x usa `relations()` por tabla (consultas relacionales v1: `fields`/`references`, pasadas a `drizzle()` junto con el esquema), mientras que 1.0 elimina esa API y usa `defineRelations` en un solo lugar (consultas relacionales v2: `r.one`/`r.many`, `from`/`to`, `through` para muchos a muchos), y además amplía `__drizzle_migrations` con `name` y `applied_at` y empareja las migraciones por nombre de carpeta. Para contemplarlo: el código declara relaciones solo en archivos `relations.ts` de cada módulo y la conexión sigue siendo el único punto que las pasa a `drizzle()` (`src/db/conexion.ts`); así subir a 1.0 reescribe esos archivos y revisa `rollback.ts` (depende de `created_at`/`hash` y del layout `NNNN_<nombre>.sql` + `.down.sql`), sin tocar el resto. Subir de versión exige un ADR nuevo y repetir la validación. Además, `bun-sql` tiene limitaciones documentadas por Drizzle (`json`/`jsonb` hacen un `JSON.stringify` extra, `timestamp` con `mode: "string"` puede fallar y los `array` tienen problemas): evitar esos tipos o probarlos antes de usarlos.
Otras consecuencias: hay que escribir y mantener a mano la reversa de cada migración; en H1 no existe rollback sobre bases de desarrollo (se aplica el `down.sql` a mano tras un respaldo propio); el `.sql` de una migración ya aplicada no debe editarse (el ejecutor lo detecta por el hash); el comportamiento de `bun-sql` con transacciones concurrentes sigue pendiente de probarse en H3 (ADR-015).
Fecha: 2026-11-22

## Recomendaciones adoptadas para arrancar
| ID | Decisión | Motivo |
|---|---|---|
| REC-001 | Dos bases PostgreSQL (privada/demo) en misma instancia local | Aislamiento de datos |
| REC-002 | UUID, centavos enteros, UTC + zona de agencia | Integridad y consistencia |
| REC-003 | Manifiesto visitante con datos ficticios completos sin contacto/finanzas | Demostración útil y prudente |
| REC-004 | Flyers repartidos entre cuadrado y vertical (cifras en doc 08) | Cobertura de formatos |
| REC-005 | Seed determinista y regeneración explícita | Reproducibilidad |
| REC-006 | Endpoints demo separados para lectura de QR/manifiestos | Menor riesgo de escritura |

## Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Sobreventa por concurrencia | Transacción, locks y prueba paralela |
| Límite bancario excedido | Reserva atómica de capacidad mensual |
| Confundir reporte con ingreso | Eventos de revisión y contabilidad neta |
| Fuga de datos entre experiencias | Bases separadas y autorización de servidor |
| Acceso por enlace robado | Expiración, consumo único, revocación, rate limit |
| Captura de demo | Watermark; asumir que no puede impedirse |
| Seed envejecido | T0 registrado y regeneración manual |
| Flyer con fecha incorrecta | Render desde datos de salida en cada seed |
| Dependencia prematura de SaaS | Adaptadores y ejecución local |
| Comportamiento de `drizzle-orm/bun-sql` con transacciones concurrentes y dos conexiones (privada/demo) no probado (ADR-015) | Pruebas de concurrencia de reserva en H3 y de aislamiento de bases en H7; alternativa probada: `pg` |

## Plantilla ADR
```md
# ADR-XXX — Título
Estado: propuesta | confirmada | reemplazada
Contexto:
Decisión:
Alternativas consideradas:
Consecuencias:
Fecha:
```
