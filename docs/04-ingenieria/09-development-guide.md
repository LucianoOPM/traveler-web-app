# 09 — Guía de desarrollo local

## Requisitos
Hacen falta **Git, Bun y Node.js**; **Docker con Compose** se usa desde H1 (issue #28) solo para PostgreSQL local y no hace falta para `bun run test` ni `bun run test:health`. Versiones validadas juntas el 2026-11-22 (ver [ADR-015](../05-decisiones/11-decisions-and-risks.md)); se fijan **exactas** (sin `^` ni `~`) en `package.json` y se respaldan con `bun.lock`:

| Componente | Versión | Notas |
|---|---|---|
| Bun | 1.4.4 | Runtime del servidor y gestor de paquetes |
| Node.js | `^22.23.4 || ^24.16.0 || >=26.3.0` (campo `engines`) | Intersección de los requisitos de Astro 7 / `@astrojs/react` 7 (`>=22.23.4`), ESLint 10.15.0 (`^20.19.0 || ^22.13.0 || >=24`) y `eslint-plugin-astro` 3.2.1 (`^22.22.3 || ^24.16.0 || >=26.3.0`); excluye Node 23 y 25 y 24.0–24.15. Validado solo con v24.22.0 (no se probaron los mínimos de cada rama). La CI usa exactamente `24.22.0` (la versión validada; ADR-022). `bun run <script>` ejecuta las CLI de Astro con Node (Bun respeta el shebang); con `bun --bun run <script>` corren con Bun; solo se probó `dev` con `--bun` y respondió 200 (issue #2); `build`, `preview` y `check` no se probaron con `--bun` |
| astro | 7.4.13 | `output: 'server'` |
| @astrojs/node | 11.1.14 | Adaptador en modo `standalone`; el build se sirve con `bun run start` (valida la configuración antes de escuchar). **No lanzar `bun ./dist/server/entry.mjs` directamente**: escucha aunque la configuración sea inválida y cada petición devuelve 500 (verificado) |
| @astrojs/react | 7.1.9 | Islands React |
| react / react-dom | 19.3.1 | Sin `compiler` en `@astrojs/react`; no instalar `oxc-transform-react` |
| typescript | 6.0.3 | devDependency. **No usar 7.x** (latest en el registro): `@astrojs/check` exige `typescript ^5 \|\| ^6` |
| @astrojs/check | 0.9.12 | devDependency; habilita `astro check` (`bun run check`) |
| @types/react / @types/react-dom | 19.3.0 | devDependencies (tipos de React) |
| @types/bun | 1.4.5 | devDependency (tipos de `bun:test`); declarado con `"types": ["bun"]` en `tsconfig.json` porque TypeScript 6 no incluye `@types/*` solo. Nota: esos tipos también aplican al código de las islas |
| drizzle-orm | 0.45.4 | Estable; no usar 1.0 RC. Driver `drizzle-orm/bun-sql` |
| drizzle-kit | 0.31.11 | devDependency; `db:generate` (`generate`) y `db:migrate` (`migrate`), con `pg` como driver (ADR-023) |
| pg | 8.23.1 | devDependency instalada en la issue #29: la exige `drizzle-kit migrate` (`db:migrate`); la aplicación usa `bun-sql` (ADR-023) |
| auth (CLI de Better Auth) | 1.7.27 | devDependency; `auth generate` crea el esquema Drizzle |
| better-auth | 1.7.27 | Plugin `admin`: `import { admin } from "better-auth/plugins"` |
| @better-auth/drizzle-adapter | 1.7.27 | `import { drizzleAdapter } from "@better-auth/drizzle-adapter"`; `drizzleAdapter(db, { provider: "pg" })` |
| prettier | 3.10.1 | devDependency; formato ([ADR-018](../05-decisiones/11-decisions-and-risks.md)) |
| prettier-plugin-astro | 1.1.2 | devDependency; formatea `.astro` (frontmatter y plantilla) |
| eslint | 10.15.0 | devDependency; flat config en `eslint.config.mjs` |
| typescript-eslint | 8.73.0 | devDependency; admite TypeScript `>=4.8.4 <6.1.0`: **antes de subir a TypeScript 6.1 o superior hay que verificar la compatibilidad** (hoy 6.0.3) |
| eslint-plugin-astro | 3.2.1 | devDependency; exige ESLint >= 10 |
| eslint-plugin-jsx-a11y-x | 0.2.0 | devDependency; accesibilidad en JSX (el clásico `eslint-plugin-jsx-a11y` 6.10.2 solo declara ESLint hasta 9). Es una versión 0.x |
| @eslint/js | 10.0.1 | devDependency; reglas base `js.configs.recommended` (no viene con ESLint) |
| globals | 17.14.0 | devDependency; globales de Node/navegador (no viene con ESLint) |
| PostgreSQL | 17.10 (imagen `postgres:17.10-alpine`, etiqueta verificada en el registro el 2026-11-22) | Solo en Docker; etiqueta exacta fijada en `docker-compose.yml` (issue #28) |

**Instalados desde la issue #29:** `drizzle-orm`, `drizzle-kit` y `pg` (exactas; son la etiqueta `latest` de npm, no hay etiqueta LTS y 1.0 sigue en beta/RC). **Aún no instalados:** `auth`, `better-auth` y `@better-auth/drizzle-adapter` (issue #31; sus filas son las versiones validadas, ADR-015). PostgreSQL solo existe en Docker (issue #28).

Detalles verificados al validar: al crear la instancia de Drizzle hay que pasar `{ schema }` (el esquema generado con `auth generate`) o el adaptador de Better Auth falla con "Drizzle schema mismatch"; el handler se monta en `src/pages/api/auth/[...all].ts`.

## Variables propuestas
```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_private
DEMO_DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_demo
AUTH_SECRET=GENERATE_A_LONG_RANDOM_SECRET
APP_ORIGIN=http://localhost:4321
PRIVATE_STORAGE_DIR=./storage/private
DEMO_STORAGE_DIR=./storage/demo
AGENCY_TIMEZONE=America/Mexico_City
# Solo para Docker Compose (no la valida la aplicación); debe coincidir con la contraseña de las URLs
POSTGRES_PASSWORD=CHANGE_ME
# Opcional y comentada en .env.example: pruebas con PostgreSQL (no la valida la aplicación)
# TEST_DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_test
```
No subir `.env`, contraseñas, cookies, tokens ni comprobantes al repositorio. `.env.example` solo contiene valores ilustrativos y **no arranca tal cual**: hay que copiarlo a `.env` y reemplazar `AUTH_SECRET` (y las contraseñas `CHANGE_ME`).

### Validación de la configuración (issue #4, [ADR-017](../05-decisiones/11-decisions-and-risks.md))
`comprobarConfiguracion(env)` en `src/lib/config.ts` devuelve la lista de problemas (vacía si todo está bien). Se ejecuta al iniciar `astro dev`, `astro build` y `bun run start` (no en `astro check`). Reglas:
- Todas las variables de la tabla son obligatorias.
- `DATABASE_URL` y `DEMO_DATABASE_URL`: URL `postgres://` o `postgresql://`, con **nombres de base distintos**.
- `AUTH_SECRET`: mínimo 32 caracteres y no un valor de ejemplo.
- `APP_ORIGIN`: URL http(s).
- `AGENCY_TIMEZONE`: zona IANA exacta (`Región/Ciudad`) o `UTC`; se rechazan offsets y abreviaturas porque PostgreSQL interpreta los offsets con el signo invertido.
- `PRIVATE_STORAGE_DIR` / `DEMO_STORAGE_DIR`: nunca dentro de `public/`; distintas y no anidadas entre sí.

Los mensajes nombran la variable y la regla, **nunca el valor**. Las variables se leen con `process.env` (`bun run` carga `.env`). **No leer secretos con `import.meta.env`**: Astro incrusta su valor dentro de `dist/`. Consecuencia: `bun run dev` y `bun run build` exigen un `.env` válido (`cp .env.example .env` y reemplazar `AUTH_SECRET`); la CI usa valores ficticios válidos.

## Inicio rápido (comandos que existen hoy)
```bash
git clone https://github.com/LucianoOPM/traveler-web-app.git
cd traveler-web-app
bun install                 # o `bun install --frozen-lockfile` (reproducible, como la CI)
bun run test:health         # prueba de salud local: NO necesita .env
```
Para `bun run dev`, `bun run build` o `bun run start` hace falta una configuración válida: `cp .env.example .env` (en PowerShell, `Copy-Item .env.example .env`) y **reemplazar `AUTH_SECRET`**, cuyo valor de ejemplo es un marcador que se rechaza. Un valor válido (mínimo 32 caracteres): `bun -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`. Es el mismo recorrido que el [README](../../README.md) raíz.

### Pendiente: todavía NO existe
Estos pasos aparecían como orientativos y **no funcionan hoy**; no ejecutarlos ni darlos por hechos:
- `bun run admin:create`: se creará en H1 (hoy `db:migrate` existe, pero no hay esquema ni migraciones reales: la primera llega con la issue #31).
- `bun run demo:seed`: se creará en H6.

## Base de datos local (issue #28)
`docker-compose.yml` define un único servicio `postgres` (`postgres:17.10-alpine`) con el volumen con nombre `traveltech_pgdata` (en Docker aparece como `traveltech_traveltech_pgdata`, con el prefijo del proyecto) y el script `docker/postgres/init/01-crear-bases.sql`, que crea `traveltech_private`, `traveltech_demo` y `traveltech_test`.
- **Arranque:** con `.env` creado, `docker compose up -d --wait` (el servicio no se declara sano hasta que las tres bases existen: el `healthcheck` usa TCP con `-h 127.0.0.1`, porque el servidor temporal de la inicialización solo escucha por socket).
- **Parada:** `docker compose down` conserva los datos; `docker compose down -v` borra el volumen y todos los datos locales.
- **Contraseña:** `POSTGRES_PASSWORD` es obligatoria (sin ella Compose falla con «Define POSTGRES_PASSWORD en .env») y debe coincidir con la de las URLs. El valor `CHANGE_ME` de `.env.example` funciona en local; cámbielo si la máquina es compartida.
- **Seguridad:** solo desarrollo. El usuario `traveltech` es superusuario y el puerto se publica únicamente en `127.0.0.1`.
- **Solución de problemas:** (1) *puerto 5432 ocupado*: pare el PostgreSQL local o el contenedor que lo usa; no se ofrece otro puerto configurable. (2) *Fallo de autenticación*: la contraseña de las URLs no coincide con `POSTGRES_PASSWORD` **en el momento de crear el volumen** (la contraseña se fija al inicializar; cambiarla después exige `down -v` o `ALTER USER`). (3) *Falta una base*: el volumen ya estaba inicializado; recréelo con `down -v`.
- **Verificado (2026-11-22, Windows 11, Docker 29.9.2, Compose v5.6.1, puerto 5432 libre):** sin `POSTGRES_PASSWORD`, `docker compose config` falla con el mensaje anterior; `up -d --wait` termina con el servicio sano (18 s en el primer arranque medido) y existen las tres bases; conexión desde el anfitrión con `Bun.SQL` y las URLs de `.env.example` a las tres bases, y una contraseña errónea se rechaza; una tabla creada en `traveltech_test` sobrevive a `down` + `up`; `down -v` borra el volumen y `up` recrea las tres bases vacías (6 s). **Límites:** no se probó en Linux ni macOS, ni con el puerto 5432 ocupado. Las pruebas automatizadas de esta issue solo comprueban el texto de los archivos (`tests/unit/docker-compose.test.ts`); no arrancan Docker.

## Migraciones (issue #29, [ADR-023](../05-decisiones/11-decisions-and-risks.md))
Drizzle: `src/db/schema.ts` (esquema), `src/db/conexion.ts` (conexión) y `drizzle.config.ts`; las migraciones viven en `src/db/migrations/` y solo avanzan (no hay `down.sql` ni rollback).
- **`bun run db:generate`:** `drizzle-kit generate` crea `NNNN_<nombre>.sql` y `meta/` a partir del esquema. No necesita base de datos.
- **`bun run db:migrate` / `bun run db:migrate:demo`:** `drizzle-kit migrate` sobre `DATABASE_URL` (privada) o, con `BASE=demo`, sobre `DEMO_DATABASE_URL`. `bun run` carga `.env`.
- **Antes de migrar** una base con datos que la migración pueda afectar, hacer una copia: `docker compose exec postgres pg_dump -U traveltech traveltech_private > copia.sql` (restaurar con `psql`).
- **No editar una migración ya aplicada**; corregir con una migración nueva.
- **Better Auth no migra (regla del responsable):** sus tablas se migran con Drizzle como las demás. Nunca ejecutar `auth migrate`; `auth generate` solo sirve para obtener el esquema de Drizzle, que se revisa, se versiona y se migra con `drizzle-kit`.
- **Pruebas con PostgreSQL:** `docker compose up -d --wait`, descomentar `TEST_DATABASE_URL` en `.env` y las pruebas usan `traveltech_test`; `tests/support/base-de-pruebas.ts` comprueba `current_database()` antes de cualquier operación destructiva y recrea el esquema cuando hace falta.

### Scripts que sí existen (issue #2)
| Script | Comando | Notas |
|---|---|---|
| `bun run dev` | `astro dev` | Sirve en `http://localhost:4321/` |
| `bun run build` | `astro build` | No comprueba tipos |
| `bun run preview` | `bun scripts/start.ts` | Igual que `start`. **No es `astro preview`**: esa CLI corre con Node, que no carga `.env`, y devolvía 500 en todas las peticiones (verificado). El puerto se cambia con `PORT` (por defecto 4321), no con `--port` |
| `bun run check` | `astro check` | Comprueba tipos con `tsconfig` estricto; falla ante errores; no exige `.env` |
| `bun run start` | `bun scripts/start.ts` | Producción (tras `build`): valida la configuración y, si es inválida, sale con código 1 sin escuchar; si es válida lanza `dist/server/entry.mjs`. Bun carga `.env` solo |
| `bun run db:generate` / `db:migrate` / `db:migrate:demo` | `drizzle-kit generate` / `drizzle-kit migrate` / `BASE=demo drizzle-kit migrate` | Ver «Migraciones». `db:migrate*` necesitan `.env` y la base en marcha |
| `bun run format` | `prettier . --write` | Reescribe el formato de los archivos (no toca `docs/`, `*.md` ni `bun.lock`) |
| `bun run format:check` | `prettier . --check` | Sale con 1 si algún archivo no cumple; no modifica nada |
| `bun run lint` | `eslint . --max-warnings 0` | ESLint sobre `.astro`, `.ts`, `.tsx` y `.mjs`; cualquier advertencia es un fallo |
| `bun run test` | `bun run test:unit && bun run test:integration` | Todas las pruebas (99: 64 unitarias y 35 de integración). No requieren `.env`, PostgreSQL ni servicios externos (verificado en un clon limpio con el entorno saneado); un fallo unitario corta la ejecución antes de la integración |
| `bun run test:unit` | `bun test ./tests/unit` | Pruebas unitarias: configuración, jerarquía de errores y conversión a respuestas, el validador de commits y la validación de commits de un rango; ~0,8 s |
| `bun run test:integration` | `bun test ./tests/integration` | Pruebas de integración: errores de `/api/` (construyen `tests/fixtures/api-errors/` con `astro build --root` y lo sirven de verdad) y salud de la app real |
| `bun run test:health` | `bun test ./tests/integration/health.test.ts` | **Prueba de salud local** (6 pruebas, ~4 s): construye la app real, la arranca con `bun run start` y comprueba `GET /api/health` y el fallo con configuración inválida. No necesita `.env`, PostgreSQL ni servicios; genera el `dist/` de la raíz y sobrescribe el existente; no ejecutarla a la vez que otra prueba de integración ni mientras corre `bun run start` desde otra rama (podría leer archivos a medio escribir; con el mismo código no se reprodujo) |

Verificado desde un clon limpio: `bun install --frozen-lockfile` no modifica `bun.lock`; `dev` (con Node y con `bun --bun`) y `astro preview` respondían 200 (antes de la validación de la issue #4; hoy `preview` es `scripts/start.ts`) y el HTML incluye el marcado de la island React (`astro-island`); la hidratación en un navegador no se comprobó. Desde la issue #4, `bun run dev` requiere antes `cp .env.example .env` y reemplazar `AUTH_SECRET`; sin eso falla a propósito. Hoy los únicos pasos del bloque anterior que funcionan son `bun install`, esa copia del `.env` y `bun run dev`.

## Estructura
```text
src/
  pages/              # Rutas Astro y endpoints
  components/         # UI e islands React
  modules/            # se crea uno por dominio (catalog, bookings, payments, tickets,
                      # operations, identity, marketing, demo, audit) al escribir su primer código
  db/                 # conexiones, migraciones, seed
  lib/                # permisos, errores, storage, utilidades
scripts/              # administración local
storage/              # archivos privados ignorados por Git
tests/                # unit, integration
docs/
```
Las carpetas se crean cuando reciben su primer archivo (sin `.gitkeep` ni carpetas vacías).

`storage/` **no existe en el repositorio**: `.gitignore` ignora `/storage/` (solo la carpeta de la raíz; una carpeta `src/lib/storage/` con código sí se versiona). Se prevé que la aplicación cree `storage/private` y `storage/demo` en tiempo de ejecución según `PRIVATE_STORAGE_DIR` y `DEMO_STORAGE_DIR`; esa decisión se confirmará en la issue #4. Las rutas configurables deben quedar bajo `storage/` o fuera del repositorio: cualquier otra ruta dentro del repo no está protegida por `.gitignore`. `.gitignore` también excluye `.env` y `.env.*` (salvo `.env.example`), `node_modules/`, `dist/`, `.astro/` y `*.log`. Los archivos privados nunca van en `public/` (ver [06-security-and-access](../02-diseno/06-security-and-access.md)).

## Convención de commits
Se recomienda [Conventional Commits](https://www.conventionalcommits.org/): `tipo(scope): descripción` con `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, etc. No hay hook ni validación en CI (ADR-021).

## Salud local (issue #8)
- **Endpoint:** `GET /api/health` responde `200` con `{ "status": "ok" }` y `Cache-Control: no-store`. Sin efectos secundarios y sin exponer configuración, secretos, versiones ni cabeceras de servidor (verificado).
- **Qué significa "ok":** que el servidor arrancó con una configuración válida: se valida al arrancar (`bun run start`) y de nuevo en la primera petición, tras la cual `getConfig()` guarda en caché la configuración válida (un fallo no se guarda, así que se reintenta). En producción el entorno del proceso no cambia desde fuera, por lo que no hay un "ok" obsoleto; en `astro dev`, editar el `.env` reinicia el servidor y `/api/health` pasa a `500` (verificado). No comprueba la base de datos, que aún no existe; si en H1 la salud la incluirá o habrá un endpoint de *readiness* aparte, **no está decidido**.
- **Con configuración inválida nunca responde "ok":** `bun run start` sale con código 1 sin escuchar; si alguien lanza `dist/server/entry.mjs` directamente (no soportado), `/api/health` responde `500 internal_error` genérico.
- **Otros métodos:** `HEAD` responde `200`; `POST`, `OPTIONS`, `PUT`, `DELETE` y `PATCH` responden `404` con la página HTML por defecto de Astro (no `405` ni el JSON uniforme de ADR-019). Esa página identifica el framework (no su versión ni la configuración) y cada petición deja un aviso `[WARN] No API Route handler exists for the method` en el registro: limitación conocida.
- **Cómo ejecutarla:** `bun run test:health` (autocontenida, ver la tabla de scripts). Es la prueba de salud local del criterio de salida de H0, que está cerrado: todas sus issues están integradas en `main` con la CI en verde (ver [00-estado](../00-estado.md)).

## Errores tipados (issue #6, [ADR-019](../05-decisiones/11-decisions-and-risks.md))
- **Lanzar:** en cualquier código de un endpoint `/api/`, `throw new ConflictError("No hay capacidad disponible", { code: "capacity_exceeded" })` (clases en `src/lib/errors.ts`: `ValidationError` 400, `UnauthenticatedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `BusinessRuleError` 422 e `InternalError` 500).la con `TypeError`. `src/middleware.ts` los convierte con `toErrorResponse` (`src/lib/error-response.ts`); no hay que envolver cada endpoint.
- **El `message` de un error tipado es público:** se devuelve tal cual. Sin valores del usuario, datos técnicos, rutas internas ni credenciales; el detalle técnico va en `cause`, que **nunca** se serializa ni se registra. `ValidationError.details` solo admite `{ field, message }`.
- **Errores inesperados** (cualquier cosa que no sea `AppError`, incluido `InternalError`): respuesta `500` genérica y una línea de registro con `console.error` (`errorName`, `method`, `path`); nunca el mensaje, la `cause`, la query ni cabeceras. En desarrollo se imprime el error completo.
- **Fuera de `/api/`** (páginas) se conserva el manejo de errores de Astro. `ConfigError` sigue siendo un error de arranque independiente.
- **Límites:** no hay biblioteca de logging ni `requestId`; los `404`/`405` de rutas `/api/` inexistentes no devuelven este JSON; un error lanzado después de empezar a enviar una respuesta en streaming no lo captura el middleware.

## Formato y lint (issue #5, [ADR-018](../05-decisiones/11-decisions-and-risks.md))
- **Antes de cada commit:** `bun run format`, `bun run lint`, `bun run check` y `bun run test`. La CI (`.github/workflows/ci.yml`, [ADR-022](../05-decisiones/11-decisions-and-risks.md)) tiene un job, `verificar`: `bun install --frozen-lockfile`, `format:check`, `lint`, `check`, `test` (no necesitan `.env`) y `build` (con variables ficticias válidas definidas en el workflow). Los rulesets de `dev` y `main` exigen `verificar` para fusionar un PR. Cómo funcionan las pruebas: [10-testing-and-quality](10-testing-and-quality.md).
- **Prettier:** `printWidth` 100, `endOfLine: "lf"` y el plugin de Astro para `*.astro`. Los saltos de línea se fijan con `.gitattributes` (`* text=auto eol=lf`): el repositorio y los checkouts quedan en LF aunque `core.autocrlf=true` (verificado en un `git clone` real: 0 archivos CRLF, `format:check` y `lint` con 0), y un archivo CRLF que alguien commitee lo detecta `format:check`. En copias locales anteriores a `.gitattributes` puede haber archivos en CRLF: `bun run format` los normaliza y Git no ve cambios. La documentación (`docs/`, `*.md`) no se formatea.
- **ESLint:** reglas recomendadas de ESLint y typescript-eslint **sin** análisis de tipos (los tipos los comprueba `astro check`), más `eslint-plugin-astro` y accesibilidad nivel `recommended` en `.astro` (`astro/jsx-a11y/*`) y en `.tsx` (`jsx-a11y-x/*`). El frontmatter de `.astro` recibe las reglas base y de TypeScript (verificado con `any`, `debugger` y variables sin usar o sin definir); los `<script>` de `.astro` se lintean como `.ts`. No se cubren `.jsx`, `.mts` ni `.cts` (hoy no hay archivos así). `reportUnusedDisableDirectives` está en `error`.
- **Excepciones:** nunca se desactiva una regla de forma global. Si es inevitable, se hace de forma puntual y justificada: `// eslint-disable-next-line <regla> -- <motivo>`. ESLint no puede exigir el motivo; se exige en la revisión.
- **Límite de la accesibilidad estática:** el lint detecta, por ejemplo, una `<label>` sin control asociado o un `<img>` sin `alt`, pero **no puede garantizar** que ningún control de formulario (`<input>`, `<select>`, `<textarea>`) carezca de nombre accesible: `control-has-associated-label` está desactivada en `recommended` e ignora `input` y `textarea`, y no se valida que el `for`/`htmlFor` de una `<label>` apunte a un `id` existente (`<label for="noexiste">` pasa); los componentes propios de control no están configurados. Para esa garantía hacen falta pruebas E2E con axe, **pendientes de decidir** ([PEN-13](../05-decisiones/pendientes.md): Playwright + `@axe-core/playwright` como candidatos, decisión con la primera interfaz real); no forman parte de la issue #5.

## Convenciones de trabajo
- Caso de uso primero, endpoint delgado, servicio transaccional, pruebas del invariante.
- Migraciones versionadas y revisadas; no editar tablas manualmente fuera de migraciones.
- Un módulo no consulta tablas ajenas sin contrato de servicio o consulta explícitamente justificada.
- Evitar lógica financiera en React; los componentes solo muestran resultados.
- Para cambiar reglas confirmadas, registrar una decisión en [11-decisions-and-risks](../05-decisiones/11-decisions-and-risks.md); si algo no está decidido, consultar [pendientes](../05-decisiones/pendientes.md).
- No usar archivos privados en `public/`; rutas de storage configurables y validadas.
- Ramas ([ADR-016](../05-decisiones/11-decisions-and-risks.md)): `main` es despliegue y `dev` es la predeterminada. Crear ramas `feat/`, `fix/`, `chore/` o `docs/` desde `dev`, y abrir PR hacia `dev`. `dev` → `main` por PR (merge commit) al cerrar un hito. Nunca hacer push directo a `main` ni a `dev`.

## Definición de terminado de una historia
Código + prueba de éxito + prueba de error/permisos + migración (si aplica) + auditoría (si aplica) + documentación breve.
