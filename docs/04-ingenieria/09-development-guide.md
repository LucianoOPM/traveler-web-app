# 09 — Guía de desarrollo local

## Requisitos
Docker con Compose, Git, Bun y Node.js. Versiones validadas juntas el 2026-11-22 (ver [ADR-015](../05-decisiones/11-decisions-and-risks.md)); se fijan **exactas** (sin `^` ni `~`) en `package.json` y se respaldan con `bun.lock`:

| Componente | Versión | Notas |
|---|---|---|
| Bun | 1.4.4 | Runtime del servidor y gestor de paquetes |
| Node.js | `^22.23.4 || ^24.16.0 || >=26.3.0` (campo `engines`) | Intersección de los requisitos de Astro 7 / `@astrojs/react` 7 (`>=22.23.4`), ESLint 10.15.0 (`^20.19.0 || ^22.13.0 || >=24`) y `eslint-plugin-astro` 3.2.1 (`^22.22.3 || ^24.16.0 || >=26.3.0`); excluye Node 23 y 25 y 24.0–24.15. Validado solo con v24.22.0 (no se probaron los mínimos de cada rama). La CI (issue #10) debe usar una de estas versiones. `bun run <script>` ejecuta las CLI de Astro con Node (Bun respeta el shebang); con `bun --bun run <script>` corren con Bun; solo se probó `dev` con `--bun` y respondió 200 (issue #2); `build`, `preview` y `check` no se probaron con `--bun` |
| astro | 7.4.13 | `output: 'server'` |
| @astrojs/node | 11.1.14 | Adaptador en modo `standalone`; el build se sirve con `bun run start` (valida la configuración antes de escuchar). **No lanzar `bun ./dist/server/entry.mjs` directamente**: escucha aunque la configuración sea inválida y cada petición devuelve 500 (verificado) |
| @astrojs/react | 7.1.9 | Islands React |
| react / react-dom | 19.3.1 | Sin `compiler` en `@astrojs/react`; no instalar `oxc-transform-react` |
| typescript | 6.0.3 | devDependency. **No usar 7.x** (latest en el registro): `@astrojs/check` exige `typescript ^5 \|\| ^6` |
| @astrojs/check | 0.9.12 | devDependency; habilita `astro check` (`bun run check`) |
| @types/react / @types/react-dom | 19.3.0 | devDependencies (tipos de React) |
| @types/bun | 1.4.5 | devDependency (tipos de `bun:test`); declarado con `"types": ["bun"]` en `tsconfig.json` porque TypeScript 6 no incluye `@types/*` solo. Nota: esos tipos también aplican al código de las islas |
| drizzle-orm | 0.45.4 | Estable; no usar 1.0 RC. Driver `drizzle-orm/bun-sql` |
| drizzle-kit | 0.31.11 | Migraciones (`generate`/`migrate`); necesita `pg` instalado |
| pg | 8.23.1 | Solo devDependency, requerida por `drizzle-kit` (la app usa `bun-sql`) |
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
| PostgreSQL | 17.10 (`postgres:17-alpine` al validar) | Solo en Docker; fijar la etiqueta exacta al crear el `docker-compose` |

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
```
No subir `.env`, contraseñas, cookies, tokens ni comprobantes al repositorio. `.env.example` solo contiene valores ilustrativos y **no arranca tal cual**: hay que copiarlo a `.env` y reemplazar `AUTH_SECRET` (y las contraseñas `CHANGE_ME`).

### Validación de la configuración (issue #4, [ADR-017](../05-decisiones/11-decisions-and-risks.md))
`src/lib/config.ts` exporta `loadConfig(raw, options?)` (función pura, con `astro/zod`), `Config` y `ConfigError`. Reglas:
- Todas las variables son obligatorias; `NODE_ENV` ∈ `development` | `test` | `production`.
- `DATABASE_URL` y `DEMO_DATABASE_URL`: URL `postgres://` o `postgresql://`, con **nombres de base distintos**.
- `AUTH_SECRET`: mínimo 32 caracteres y no puede ser un valor de ejemplo (`GENERATE_A_LONG_RANDOM_SECRET`, `CHANGE_ME`).
- `APP_ORIGIN`: origen http(s) sin ruta, parámetros ni credenciales (se normaliza).
- `AGENCY_TIMEZONE`: zona IANA canónica con formato `Región/Ciudad` (sensible a mayúsculas) o `UTC`. Se rechazan offsets (`+03:00`) y abreviaturas (`EST`): PostgreSQL interpreta los offsets numéricos con el signo POSIX invertido.
- `PRIVATE_STORAGE_DIR` / `DEMO_STORAGE_DIR`: bajo `<raíz>/storage` o fuera del repositorio; nunca en `public/` ni en otras carpetas del repo; distintas y no anidadas entre sí.

Los errores nombran la variable y la regla, **nunca el valor**. En servidor se lee con `getConfig()` (`src/lib/config.runtime.ts`, usa `getSecret()` de `astro:env/server`; no puede importarse desde código de cliente). **No leer secretos con `import.meta.env`**: Astro incrusta su valor dentro de `dist/` (verificado). Se valida al iniciar `astro dev`, `astro build` y `bun run start`; `astro check` no valida, para poder comprobar tipos sin secretos. Consecuencia: **`bun run dev` y `bun run build` exigen un `.env` válido o variables de entorno reales** (en CI hay que definir valores ficticios válidos).

## Inicio recomendado (comandos orientativos)
```bash
bun install
docker compose up -d
bun run db:migrate
bun run admin:create
bun run dev
```
Los scripts `db:migrate`, `admin:create` y `demo:seed` se crearán en H1/H6; **no se afirma que existan todavía**.

### Scripts que sí existen (issue #2)
| Script | Comando | Notas |
|---|---|---|
| `bun run dev` | `astro dev` | Sirve en `http://localhost:4321/` |
| `bun run build` | `astro build` | No comprueba tipos |
| `bun run preview` | `bun scripts/start.ts` | Igual que `start`. **No es `astro preview`**: esa CLI corre con Node, que no carga `.env`, y devolvía 500 en todas las peticiones (verificado). El puerto se cambia con `PORT` (por defecto 4321), no con `--port` |
| `bun run check` | `astro check` | Comprueba tipos con `tsconfig` estricto; falla ante errores; no exige `.env` |
| `bun run start` | `bun scripts/start.ts` | Producción (tras `build`): valida la configuración y, si es inválida, sale con código 1 sin escuchar; si es válida lanza `dist/server/entry.mjs`. Bun carga `.env` solo |
| `bun run format` | `prettier . --write` | Reescribe el formato de los archivos (no toca `docs/`, `*.md` ni `bun.lock`) |
| `bun run format:check` | `prettier . --check` | Sale con 1 si algún archivo no cumple; no modifica nada |
| `bun run lint` | `eslint . --max-warnings 0` | ESLint sobre `.astro`, `.ts`, `.tsx` y `.mjs`; cualquier advertencia es un fallo |
| `bun test tests/unit` | — | Pruebas unitarias de `loadConfig` (16). La infraestructura formal de pruebas llega con la issue #7 |

Verificado desde un clon limpio: `bun install --frozen-lockfile` no modifica `bun.lock`; `dev` (con Node y con `bun --bun`) y `astro preview` respondían 200 (antes de la validación de la issue #4; hoy `preview` es `scripts/start.ts`) y el HTML incluye el marcado de la island React (`astro-island`); la hidratación en un navegador no se comprobó. Desde la issue #4, `bun run dev` requiere antes `cp .env.example .env` y reemplazar `AUTH_SECRET`; sin eso falla a propósito. Hoy los únicos pasos del bloque anterior que funcionan son `bun install`, esa copia del `.env` y `bun run dev`.

## Estructura
```text
src/
  pages/              # Rutas Astro y endpoints
  components/         # UI e islands React
  modules/
    catalog/           # schema, domain, service, repository
    bookings/
    payments/
    tickets/
    operations/
    marketing/
    identity/
    demo/
    audit/
  db/                 # conexiones, migraciones, seed
  lib/                # permisos, errores, storage, utilidades
scripts/              # administración local
storage/              # archivos privados ignorados por Git
tests/                # unit, integration, e2e
docs/
```
Estado (issue #3): las carpetas de `src/modules/*`, `src/db`, `src/lib`, `scripts/` y `tests/*` existen y se versionan con un `.gitkeep` (Git no guarda carpetas vacías); se borrará el `.gitkeep` de cada una cuando reciba su primer archivo. Los módulos aún no tienen subcarpetas internas (`schema`, `domain`...): se crean con el primer código.

`storage/` **no existe en el repositorio**: `.gitignore` ignora `/storage/` (solo la carpeta de la raíz; una carpeta `src/lib/storage/` con código sí se versiona). Se prevé que la aplicación cree `storage/private` y `storage/demo` en tiempo de ejecución según `PRIVATE_STORAGE_DIR` y `DEMO_STORAGE_DIR`; esa decisión se confirmará en la issue #4. Las rutas configurables deben quedar bajo `storage/` o fuera del repositorio: cualquier otra ruta dentro del repo no está protegida por `.gitignore`. `.gitignore` también excluye `.env` y `.env.*` (salvo `.env.example`), `node_modules/`, `dist/`, `.astro/` y `*.log`. Los archivos privados nunca van en `public/` (ver [06-security-and-access](../02-diseno/06-security-and-access.md)).

## Formato y lint (issue #5, [ADR-018](../05-decisiones/11-decisions-and-risks.md))
- **Antes de cada commit:** `bun run format`, `bun run lint`, `bun run check` y `bun test tests/unit`. La CI (issue #10) ejecutará `format:check` y `lint` y necesita definir variables de entorno ficticias válidas para `build`.
- **Prettier:** `printWidth` 100, `endOfLine: "lf"` y el plugin de Astro para `*.astro`. Los saltos de línea se fijan con `.gitattributes` (`* text=auto eol=lf`): el repositorio y los checkouts quedan en LF aunque `core.autocrlf=true` (verificado en un `git clone` real: 0 archivos CRLF, `format:check` y `lint` con 0), y un archivo CRLF que alguien commitee lo detecta `format:check`. En copias locales anteriores a `.gitattributes` puede haber archivos en CRLF: `bun run format` los normaliza y Git no ve cambios. La documentación (`docs/`, `*.md`) no se formatea.
- **ESLint:** reglas recomendadas de ESLint y typescript-eslint **sin** análisis de tipos (los tipos los comprueba `astro check`), más `eslint-plugin-astro` y accesibilidad nivel `recommended` en `.astro` (`astro/jsx-a11y/*`) y en `.tsx` (`jsx-a11y-x/*`). El frontmatter de `.astro` recibe las reglas base y de TypeScript (verificado con `any`, `debugger` y variables sin usar o sin definir); los `<script>` de `.astro` se lintean como `.ts`. No se cubren `.jsx`, `.mts` ni `.cts` (hoy no hay archivos así). `reportUnusedDisableDirectives` está en `error`.
- **Excepciones:** nunca se desactiva una regla de forma global. Si es inevitable, se hace de forma puntual y justificada: `// eslint-disable-next-line <regla> -- <motivo>`. ESLint no puede exigir el motivo; se exige en la revisión.
- **Límite de la accesibilidad estática:** el lint detecta, por ejemplo, una `<label>` sin control asociado o un `<img>` sin `alt`, pero **no puede garantizar** que ningún control de formulario (`<input>`, `<select>`, `<textarea>`) carezca de nombre accesible: `control-has-associated-label` está desactivada en `recommended` e ignora `input` y `textarea`, y no se valida que el `for`/`htmlFor` de una `<label>` apunte a un `id` existente (`<label for="noexiste">` pasa); los componentes propios de control no están configurados. Para esa garantía hacen falta pruebas E2E con axe, **aún sin planificar** ([PEN-13](../05-decisiones/pendientes.md)); no forman parte de la issue #5.

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
