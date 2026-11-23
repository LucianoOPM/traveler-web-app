# 09 — Guía de desarrollo local

## Requisitos
**Git, Bun y Node.js.** Docker con Compose solo para PostgreSQL local (no hace falta para `bun run test` ni `bun run test:health`). Las versiones exactas están en `package.json` y se respaldan con `bun.lock` ([ADR-015](../05-decisiones/11-decisions-and-risks.md)); no usar `^` ni `~`.

Notas que no se ven en `package.json`:
- **Node:** `^22.23.4 || ^24.16.0 || >=26.3.0` (campo `engines`); la CI usa `24.22.0`. `bun run <script>` ejecuta las CLI de Astro con Node.
- **TypeScript 6.0.3:** no subir a 6.1+ sin comprobar `typescript-eslint` (admite `<6.1.0`) y `@astrojs/check`.
- **Drizzle 0.45.4:** no usar 1.0 RC. `pg` es devDependency solo porque `drizzle-kit` la necesita; la aplicación usa `drizzle-orm/bun-sql`.
- **Better Auth 1.7.27** (`auth`, `better-auth`, `@better-auth/drizzle-adapter`): instaladas con versión exacta (`auth` solo en desarrollo). La instancia está en `src/modules/identity/auth.ts` (UUID, Admin plugin con roles `admin` y `operator`, `defaultRole: "operator"`, registro cerrado; el handler aún no está montado). Con Drizzle hay que pasar `{ schema }` al crear la instancia o el adaptador falla con «Drizzle schema mismatch».
- **PostgreSQL 17.10** (`postgres:17.10-alpine`): solo en Docker.

## Variables de entorno
```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_private
DEMO_DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_demo
AUTH_SECRET=GENERATE_A_LONG_RANDOM_SECRET
APP_ORIGIN=http://localhost:4321
PRIVATE_STORAGE_DIR=./storage/private
DEMO_STORAGE_DIR=./storage/demo
AGENCY_TIMEZONE=America/Mexico_City
# Solo para Docker Compose; debe coincidir con la contraseña de las URLs
POSTGRES_PASSWORD=CHANGE_ME
# Opcional (pruebas con PostgreSQL), comentada en .env.example
# TEST_DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_test
```
No subir `.env`, contraseñas, cookies, tokens ni comprobantes al repositorio. `.env.example` **no arranca tal cual**: hay que copiarlo a `.env` y reemplazar `AUTH_SECRET`.

`comprobarConfiguracion(env)` en `src/lib/config.ts` ([ADR-017](../05-decisiones/11-decisions-and-risks.md)) se ejecuta al iniciar `astro dev`, `astro build` y `bun run start` (no en `astro check`). Reglas:
- Todas las variables de arriba (menos `NODE_ENV`, `POSTGRES_PASSWORD` y `TEST_DATABASE_URL`) son obligatorias.
- `DATABASE_URL` y `DEMO_DATABASE_URL`: URL `postgres://` o `postgresql://` con **nombres de base distintos**.
- `AUTH_SECRET`: mínimo 32 caracteres y no un valor de ejemplo.
- `APP_ORIGIN`: URL http(s).
- `AGENCY_TIMEZONE`: zona IANA exacta o `UTC`; se rechazan offsets y abreviaturas porque PostgreSQL interpreta los offsets con el signo invertido.
- `PRIVATE_STORAGE_DIR` / `DEMO_STORAGE_DIR`: nunca dentro de `public/`; distintas y no anidadas entre sí.

Los mensajes nombran la variable y la regla, **nunca el valor**. Las variables se leen con `process.env` (`bun run` carga `.env`). **No usar `import.meta.env` para secretos**: Astro incrusta su valor dentro de `dist/`.

## Inicio rápido
```bash
git clone https://github.com/LucianoOPM/traveler-web-app.git
cd traveler-web-app
bun install                 # o `bun install --frozen-lockfile` (como la CI)
bun run test:health         # prueba de salud local: NO necesita .env
```
Para `bun run dev`, `build` o `start`: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`) y reemplazar `AUTH_SECRET`. Un valor válido: `bun -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`.

**Administrador inicial:** con las migraciones aplicadas, `bun run admin:create` ejecuta `auth create-admin` (Better Auth) sobre la base privada (`DATABASE_URL`): pide correo y contraseña de forma interactiva y guarda la contraseña solo como hash. **No pases `--password`**: queda en el historial y en la lista de procesos. Si ya hay usuarios pide confirmación. Todavía **no existe** `bun run demo:seed` (H6).

## Base de datos local
`docker-compose.yml` define el servicio `postgres` con el volumen `traveltech_pgdata` y `docker/postgres/init/01-crear-bases.sql`, que crea `traveltech_private`, `traveltech_demo` y `traveltech_test`.
- **Arranque:** `docker compose up -d --wait` (con `.env` creado). **Parada:** `docker compose down` conserva los datos; `down -v` borra el volumen y las tres bases.
- **Contraseña:** `POSTGRES_PASSWORD` es obligatoria y debe coincidir con la de las URLs. Solo se fija al crear el volumen.
- **Seguridad:** solo desarrollo: el usuario `traveltech` es superusuario y el puerto se publica únicamente en `127.0.0.1`.
- **Problemas:** *puerto 5432 ocupado* → pare el PostgreSQL que lo usa. *Fallo de autenticación* o *falta una base* → el volumen se inicializó con otros valores; recréelo con `down -v`.

## Migraciones ([ADR-023](../05-decisiones/11-decisions-and-risks.md))
Drizzle: `src/db/schema.ts` (esquema), `src/db/conexion.ts` (conexión) y `drizzle.config.ts`; las migraciones viven en `src/db/migrations/` y solo avanzan (sin `down.sql` ni rollback).
- `bun run db:generate`: crea `NNNN_<nombre>.sql` y `meta/` a partir del esquema. No necesita base de datos.
- `bun run db:migrate` / `bun run db:migrate:demo`: `drizzle-kit migrate` sobre `DATABASE_URL` (privada) o, con `BASE=demo`, sobre `DEMO_DATABASE_URL`.
- **Antes de migrar** una base con datos que la migración pueda afectar, hacer una copia: `docker compose exec postgres pg_dump -U traveltech traveltech_private > copia.sql`.
- No editar una migración ya aplicada; corregir con una migración nueva.
- **Better Auth no migra:** sus tablas se migran con Drizzle. Nunca `auth migrate`; `auth generate` solo sirve para obtener el esquema de Drizzle, que se revisa, se versiona y se migra con `drizzle-kit`. Para regenerar el esquema de identidad (`DATABASE_URL` puede ser ficticia; no se conecta): `bunx --bun auth generate --adapter drizzle --dialect pg --config src/modules/identity/auth.ts --output src/modules/identity/schema.ts --yes`. Después hay que repetir a mano dos correcciones: fechas con `{ withTimezone: true }` (la CLI genera `timestamp` sin zona) y relaciones fuera de `schema.ts`, en `relations.ts`. Validar con `bunx --bun auth check schema --config src/modules/identity/auth.ts`.
- **Pruebas con PostgreSQL:** `docker compose up -d --wait`, descomentar `TEST_DATABASE_URL` en `.env`. `tests/support/base-de-pruebas.ts` comprueba `current_database()` antes de cualquier operación destructiva y recrea el esquema de `traveltech_test` cuando hace falta.

## Scripts
| Script | Qué hace |
|---|---|
| `bun run dev` | `astro dev` en `http://localhost:4321/` |
| `bun run build` | `astro build` (no comprueba tipos) |
| `bun run start` / `preview` | `bun scripts/start.ts`: valida la configuración, sale con código 1 sin escuchar si es inválida y, si no, lanza `dist/server/entry.mjs`. El puerto se cambia con `PORT`. No es `astro preview` (corre con Node, que no carga `.env`) |
| `bun run check` | `astro check` (tipos; no exige `.env`) |
| `bun run format` / `format:check` | Prettier (no toca `docs/`, `*.md` ni `bun.lock`) |
| `bun run lint` | ESLint con `--max-warnings 0` |
| `bun run test` | `test:unit` y luego `test:integration` |
| `bun run test:health` | Construye la app real, la arranca y comprueba `GET /api/health` y el fallo con configuración inválida. No necesita `.env` ni PostgreSQL; sobrescribe el `dist/` de la raíz, así que no ejecutarla a la vez que otras pruebas de integración |
| `bun run db:generate` / `db:migrate` / `db:migrate:demo` | Ver «Migraciones» |

## Estructura
```text
src/
  pages/        # Rutas Astro y endpoints
  components/   # UI e islands React
  modules/      # un módulo por dominio (catalog, bookings, payments, tickets, operations,
                # identity, marketing, demo, audit), creado al escribir su primer código
  db/           # esquema, conexión y migraciones
  lib/          # configuración, errores y utilidades
scripts/        # arranque de producción
storage/        # archivos privados (ignorado por Git; la app lo creará en ejecución)
tests/          # unit, integration, fixtures y support
docs/
```
Las carpetas se crean cuando reciben su primer archivo. Los archivos privados nunca van en `public/` ([06-security-and-access](../02-diseno/06-security-and-access.md)).

## Convención de commits
Se recomienda [Conventional Commits](https://www.conventionalcommits.org/): `tipo(scope): descripción` con `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, etc. No hay hook ni validación en CI ([ADR-021](../05-decisiones/11-decisions-and-risks.md)).

## Salud local
`GET /api/health` responde `200` con `{ "status": "ok" }` y `Cache-Control: no-store`, sin efectos secundarios y sin exponer configuración. «Ok» significa que el servidor arrancó con configuración válida; no comprueba la base de datos (aún no hay). `HEAD` responde `200`; los demás métodos responden `404` con la página por defecto de Astro.

## Errores tipados ([ADR-019](../05-decisiones/11-decisions-and-risks.md))
- **Lanzar:** en cualquier código de un endpoint `/api/`, `throw new ConflictError("No hay capacidad disponible", { code: "capacity_exceeded" })`. Clases en `src/lib/errors.ts`: `ValidationError` 400, `UnauthenticatedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `BusinessRuleError` 422 e `InternalError` 500. `src/middleware.ts` los convierte con `toErrorResponse`; no hay que envolver cada endpoint.
- **El `message` de un error tipado es público:** sin valores del usuario, datos técnicos, rutas ni credenciales; el detalle técnico va en `cause`, que nunca se serializa ni se registra. `ValidationError.details` solo admite `{ field, message }`.
- **Inesperados** (cualquier cosa que no sea `AppError`, incluido `InternalError`): `500` genérico y una línea de registro (`errorName`, `method`, `path`); nunca mensaje, `cause`, query ni cabeceras. En desarrollo se imprime el error completo.
- Fuera de `/api/` se conserva el manejo de errores de Astro. Sin biblioteca de logging ni `requestId`.

## Formato y lint ([ADR-018](../05-decisiones/11-decisions-and-risks.md))
- **Antes de cada commit:** `bun run format`, `lint`, `check` y `test`. La CI (`.github/workflows/ci.yml`, [ADR-022](../05-decisiones/11-decisions-and-risks.md)) tiene un job, `verificar`, con `format:check`, `lint`, `check`, `test` y `build` (con variables ficticias válidas); es obligatorio para fusionar en `dev` y `main`.
- **ESLint:** reglas recomendadas sin análisis de tipos, `eslint-plugin-astro` y accesibilidad `recommended` en `.astro` y `.tsx`. Nunca se desactiva una regla de forma global; si es inevitable: `// eslint-disable-next-line <regla> -- <motivo>`.
- **Límite:** el lint no garantiza que cada control de formulario tenga nombre accesible; requeriría pruebas E2E con axe (PEN-13).

## Convenciones de trabajo
- Caso de uso primero, endpoint delgado, servicio transaccional, pruebas del invariante.
- Un módulo no consulta tablas ajenas sin contrato de servicio o consulta explícitamente justificada.
- Sin lógica financiera en React; los componentes solo muestran resultados.
- Para cambiar reglas confirmadas, registrar una decisión en [11-decisions-and-risks](../05-decisiones/11-decisions-and-risks.md); si algo no está decidido, consultar [pendientes](../05-decisiones/pendientes.md).
- Ramas ([ADR-016](../05-decisiones/11-decisions-and-risks.md)): ramas `feat/`, `fix/`, `chore/` o `docs/` desde `dev` y PR hacia `dev`; `dev` → `main` por PR (merge commit) al cerrar un hito. Nunca push directo a `main` ni a `dev`.

## Definición de terminado de una historia
Código + prueba de éxito + prueba de error/permisos + migración (si aplica) + auditoría (si aplica) + documentación breve.
