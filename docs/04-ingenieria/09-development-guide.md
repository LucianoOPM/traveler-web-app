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
BETTER_AUTH_SECRET=GENERATE_A_LONG_RANDOM_SECRET
BETTER_AUTH_URL=http://localhost:4321
PRIVATE_STORAGE_DIR=./storage/private
DEMO_STORAGE_DIR=./storage/demo
AGENCY_TIMEZONE=America/Mexico_City
# Solo para Docker Compose; debe coincidir con la contraseña de las URLs
POSTGRES_PASSWORD=CHANGE_ME
# Opcional (pruebas con PostgreSQL), comentada en .env.example
# TEST_DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_test
```
No subir `.env`, contraseñas, cookies, tokens ni comprobantes al repositorio. `.env.example` **no arranca tal cual**: hay que copiarlo a `.env` y reemplazar `BETTER_AUTH_SECRET`.

`comprobarConfiguracion(env)` en `src/lib/config.ts` ([ADR-017](../05-decisiones/11-decisions-and-risks.md)) se ejecuta al iniciar `astro dev`, `astro build` y `bun run start` (no en `astro check`). Reglas:
- Todas las variables de arriba (menos `NODE_ENV`, `POSTGRES_PASSWORD` y `TEST_DATABASE_URL`) son obligatorias.
- `DATABASE_URL` y `DEMO_DATABASE_URL`: URL `postgres://` o `postgresql://` con **nombres de base distintos**.
- `BETTER_AUTH_SECRET`: mínimo 32 caracteres y no un valor de ejemplo.
- `BETTER_AUTH_URL`: URL http(s).
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
Para `bun run dev`, `build` o `start`: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`) y reemplazar `BETTER_AUTH_SECRET`. Un valor válido: `bun -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`.

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
| `bun run dev` | `astro dev` bajo Bun (`bunx --bun`, necesario para `bun-sql`) en `http://localhost:4321/` |
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
  pages/        # Rutas Astro (SSR) y API Routes
  actions/      # Astro Actions, un archivo por módulo (ADR-025)
  components/   # UI e islands React
  layouts/      # layouts Astro (AdminLayout: área privada)
  modules/      # un módulo por dominio (catalog, bookings, payments, tickets, operations,
                # identity, marketing, demo, audit), creado al escribir su primer código;
                # con domain/, application/, infrastructure/, container.ts, schema.ts y
                # relations.ts (ADR-026)
  db/           # esquema, conexión y migraciones
  lib/          # configuración, errores y utilidades
scripts/        # arranque de producción
storage/        # archivos privados (ignorado por Git; la app lo creará en ejecución)
tests/          # unit, integration, fixtures y support
docs/
```
Las carpetas se crean cuando reciben su primer archivo. Los archivos privados nunca van en `public/` ([06-security-and-access](../02-diseno/06-security-and-access.md)).

## Servicios, repositorios y Actions (ADR-025, ADR-026)
- **Servicio:** clase en `application/` que implementa un caso de uso y recibe sus dependencias (repositorios, adaptadores) por constructor. Nunca importa la base de datos ni lee `process.env`.
- **Repositorio:** clase en `infrastructure/` con Drizzle; su interfaz vive en `domain/` solo si el servicio la necesita para probarse con un repositorio falso. Sin lógica de permisos.
- **Dominio:** funciones puras para reglas, cálculos y transiciones. Las invariantes se comprueban en el servicio aunque la Action ya valide la forma.
- **Composición:** `container.ts` del módulo construye repositorios y servicios; es el único sitio que conoce las clases concretas.
- **Action:** valida con `input` (Zod desde `astro/zod`, `z.strictObject` en escrituras; ADR-024), comprueba sesión y permiso **dentro del handler**, llama al servicio y devuelve el resultado. Pasa por el adaptador `AppError` → `ActionError`: sin él, Astro devolvería al cliente el mensaje de un error inesperado. El middleware resuelve la sesión en `/_actions/`, pero eso no sustituye la comprobación del handler.
- **Transacciones:** las abre el servicio, no la Action ni el repositorio; varios repositorios comparten el mismo `db`/`tx`.
- **Pruebas:** reglas puras (unitarias); servicios con repositorios falsos o en memoria (unitarias); repositorios y transacciones contra PostgreSQL real (integración); permisos de cada Action con peticiones directas sin sesión y con rol insuficiente.
- **No crear** interfaces, factories ni clases «por si acaso»: se añaden cuando hay una dependencia que abstraer o un segundo uso real.

## Convención de commits
Se recomienda [Conventional Commits](https://www.conventionalcommits.org/): `tipo(scope): descripción` con `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, etc. No hay hook ni validación en CI ([ADR-021](../05-decisiones/11-decisions-and-risks.md)).

## Autenticación del personal
- **Handler:** `src/pages/api/auth/[...all].ts` delega en Better Auth (`/api/auth/*`, fuera de `/api/v1/`). Registro público cerrado: el personal lo crea `bun run admin:create` (o un admin).
- **Sesión:** el middleware (`src/middleware.ts`) la resuelve solo en `/admin` y subrutas y la deja en `Astro.locals.user` y `Astro.locals.session` (tipos en `src/env.d.ts`); en las demás rutas quedan sin definir. `auth` se importa de forma dinámica para que `/api/health` no cargue Better Auth ni necesite la base de datos.
- **Límite de intentos:** Better Auth lo activa por defecto solo con `NODE_ENV=production` (3 intentos por 10 s en `/sign-in` y `/sign-up`, por IP, en memoria del proceso). El handler descarta el `x-forwarded-for` del cliente y lo sustituye por `clientAddress`, que Astro toma del socket (solo lee `x-forwarded-for` si se configura `security.allowedDomains`; no se configura). Sin IP, Better Auth usa un cubo compartido por ruta y sigue limitando. **Detrás de un proxy inverso**, `clientAddress` sería la IP del proxy y todos compartirían cubo: revisarlo al decidir el despliegue ([PEN-08](../05-decisiones/pendientes.md)).
- **Rutas protegidas:** el middleware también resuelve la sesión en `/login`. Para `/admin` y subrutas: sin sesión → `302` a `/login`; usuario vetado o sin rol `admin`/`operator` → `403`; todas con `Cache-Control: no-store`. Los roles salen de `roles` en `auth.ts` (un usuario puede tener varios separados por coma). Los permisos por operación se validan aparte, en cada endpoint.
- **Pantallas:** `/login` (formulario Astro con un `<script>` mínimo que llama a `/api/auth/sign-in/email`; error genérico) y `/admin` (bienvenida) con `src/layouts/AdminLayout.astro`, que incluye «Cerrar sesión» (`POST /api/auth/sign-out`). La primera cuenta se crea con `bun run admin:create`.
- **Runtime:** el driver `bun-sql` solo existe bajo Bun. `bun run dev` ejecuta `astro dev` con `bunx --bun`; `build` corre bajo Node y deja `bun` como importación externa (`astro.config.mjs`); `bun run start` ejecuta el build bajo Bun.

## Salud local
`GET /api/health` responde `200` con `{ "status": "ok" }` y `Cache-Control: no-store`, sin efectos secundarios y sin exponer configuración. «Ok» significa que el servidor arrancó con configuración válida; no comprueba la base de datos (aún no hay). `HEAD` responde `200`; los demás métodos responden `404` con la página por defecto de Astro. No carga Better Auth ni resuelve sesión; su prueba usa una base inalcanzable (puerto cerrado) y sigue respondiendo 200.

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
