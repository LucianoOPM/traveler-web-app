# Issue #4 — Variables de entorno, .env.example y validación de configuración (diseño)

**Aprobado por el responsable en la conversación (2026-11-22).** Tamaño: proyecto pequeño-mediano (un módulo, un script y un experimento previo).

## Intención
Que la aplicación **no arranque con configuración inválida** y que **ningún secreto llegue al cliente, a logs ni al build**. Criterio de aceptación de la issue: la app no arranca con configuración inválida y ningún secreto llega al cliente ni a logs.

## Metas
- `.env.example` con las 8 variables de la guía (valores ilustrativos): `NODE_ENV`, `DATABASE_URL`, `DEMO_DATABASE_URL`, `AUTH_SECRET`, `APP_ORIGIN`, `PRIVATE_STORAGE_DIR`, `DEMO_STORAGE_DIR`, `AGENCY_TIMEZONE`.
- `src/lib/config.ts`: función pura `loadConfig(raw, options?)` con `astro/zod` (Zod 4), probada con `bun test`.
- Validar al arrancar: en `astro.config.mjs` (dev y build) y en un script `start` (producción) que valida y luego lanza `dist/server/entry.mjs`; el middleware queda como defensa adicional.
- Rutas de storage validadas; selección de base solo en servidor.

## No metas
Conexión real a PostgreSQL y selección efectiva de base (H1/H7), Better Auth, errores tipados globales (issue #6), infraestructura formal de pruebas (#7), lint (#5), resolver PEN-10.

## Anti-metas
Secretos dentro de `dist/`; mensajes de error con valores; leer secretos con `import.meta.env`; que el servidor de producción arranque con configuración inválida.

## Restricciones y hechos verificados
- Librería: `astro/zod` (re-export de Zod 4, sin dependencia nueva). **PEN-10 sigue abierto**; se anota como candidato natural en el ADR.
- Zod 4: `z.url()`, errores con `{ error: "..." }`, validación entre campos con `superRefine`/`ctx.addIssue({ path })`, formato con `z.prettifyError`.
- **Medido (proyecto desechable):** `import.meta.env.X` hornea el valor del `.env` dentro de `dist/` (no usar para secretos); en `astro dev` (Node por el shebang de la CLI) `process.env` no ve el `.env`; el middleware de Astro se carga en la primera petición, no al arrancar. **Por verificar en la implementación:** qué devuelve `getSecret()` de `astro:env/server` en dev y en producción, y si Bun carga `.env` en `bun scripts/start.ts`.
- Context7: `getSecret()` está documentado como "usa `process.env` en dev y build"; ni Astro ni el adaptador cargan variables en producción (el entorno o Bun deben proveerlas).
- Sin Python. Commits en Conventional Commits. Rama `feat/h0-configuracion-entorno`; PR a `dev` con `Closes #4` (ADR-016).

## Enfoques
1. **`loadConfig` puro + adaptador fino + script `start` (elegido):** lo único dependiente de Astro es el adaptador; la lógica se prueba sin Astro.
2. **Solo `envField`/`astro:env`:** descartado; no se prueba con `bun test`, valida secretos solo al ejecutar y no expresa reglas entre variables.
3. **Validar solo de forma perezosa en el middleware:** descartado; el servidor arrancaría con configuración inválida.

## Reglas de validación (decisiones)
- Todas las variables son obligatorias (incluida `NODE_ENV`: `development` | `test` | `production`); los errores listan el nombre de la variable y la regla, **nunca el valor**.
- `DATABASE_URL` y `DEMO_DATABASE_URL`: URL con protocolo `postgres://` o `postgresql://`, con **nombres de base distintos**.
- `AUTH_SECRET`: mínimo 32 caracteres y no puede ser el valor de ejemplo (`GENERATE_A_LONG_RANDOM_SECRET`, `CHANGE_ME`). El `.env.example` fallará a propósito hasta que se genere uno real.
- `APP_ORIGIN`: URL http(s) solo con origen (sin ruta); se normaliza. Exigir https en producción **no está decidido** (no se impone; candidato a `pendientes.md`).
- `AGENCY_TIMEZONE`: zona IANA válida (comprobada con `Intl.DateTimeFormat`).
- Storage: cada ruta se resuelve contra la raíz del proyecto y debe quedar **dentro de `<raíz>/storage`** o **totalmente fuera de la raíz**; nunca bajo `<raíz>/public` ni en otras carpetas del repo; las dos rutas deben ser distintas y ninguna contiene a la otra. `loadConfig` acepta `options.projectRoot` para poder probarlo.
- El módulo de lectura en servidor (`astro:env/server`) no puede importarse desde código de cliente.

## A cargo del constructor
Nombres internos de funciones auxiliares; texto exacto de los mensajes (siempre sin valores); si `@types/bun` hace falta para tipar `bun:test` bajo `astro check` (se fija exacto si se añade); si `src/middleware.ts` se mantiene mínimo.
