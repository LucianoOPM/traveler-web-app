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
| ADR-017 | Validación de configuración con `loadConfig` (`astro/zod`), lectura con `getSecret()` y script `start` que falla antes de escuchar | Confirmada |
| ADR-018 | Formato con Prettier y lint con ESLint 10 (plugin Astro, accesibilidad `recommended`); typescript-eslint limita TypeScript a `<6.1.0` | Confirmada |

### ADR-015 — Versiones del stack y driver de PostgreSQL
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
Decisión: `main` es la rama de despliegue y `dev` la rama predeterminada de desarrollo. Las ramas de trabajo (`feat/`, `fix/`, `chore/`, `docs/`) salen de `dev` y vuelven a ella por PR. `dev` se fusiona a `main` por PR cuando un hito esté listo o se vaya a desplegar, con *merge commit* (no *squash*) para que no diverjan. Los hotfix salen de `main` y se devuelven a `dev`. Protección de `dev` y `main` (rulesets de GitHub): exigir PR, **sin aprobaciones obligatorias**, y bloquear force-push y borrado; sin checks de CI obligatorios hasta que exista la CI (issue #10).
Alternativas consideradas: trabajo directo sobre `main`; exigir aprobación en `main` (descartado: un único responsable no puede aprobar sus propios PR).
Consecuencias: `Closes #N` solo cierra issues al fusionar en `dev` (la predeterminada); al fusionar `dev` → `main` hay que cerrar a mano las que queden abiertas. Cuando exista CI, añadirla como check requerido. El despliegue desde `main` depende de PEN-08.
Fecha: 2026-11-22

### ADR-017 — Validación de configuración de entorno
Estado: confirmada
Contexto: la issue #4 exige que la aplicación no arranque con configuración inválida y que ningún secreto llegue al cliente, a logs ni al build. Midiendo en un proyecto desechable se verificó que `import.meta.env.X` incrusta el valor del `.env` dentro de `dist/`; que en `astro dev` (CLI sobre Node) `process.env` no ve el `.env`; que el middleware de Astro se carga en la primera petición y no al arrancar; y que `getSecret()` de `astro:env/server` lee el `.env` en dev, no lo incrusta en `dist/`, lee las variables reales en producción y, con Bun, el `.env` se autocarga.
Decisión: `loadConfig(raw, options?)` puro en `src/lib/config.ts`, escrito con `astro/zod` (re-export de Zod 4 incluido en Astro; sin dependencia nueva). Lectura en servidor con `getSecret()` en `src/lib/config.runtime.ts` (módulo solo servidor: importarlo desde una isla React rompe el build con `ServerOnlyModule`). Se valida al iniciar `astro dev` y `astro build` (hook `astro:config:setup`, no en `check`/`sync`) y en el script `bun run start`, que sale con código 1 antes de escuchar; el middleware lo comprueba de nuevo como defensa. Reglas detalladas en [09-development-guide](../04-ingenieria/09-development-guide.md). Para tipar `bun:test` se añade `@types/bun` 1.4.5 y `"types": ["bun"]` en `tsconfig.json` (TypeScript 6 ya no incluye `@types/*` automáticamente).
Alternativas consideradas: solo `envField`/`astro:env` (no se prueba con `bun test`, valida secretos solo en ejecución y no expresa reglas entre variables); validar solo en el middleware (el servidor arrancaría con configuración inválida); Valibot o validación manual.
Consecuencias: `bun run dev` y `bun run build` exigen un `.env` válido o variables reales (CI debe definir valores ficticios válidos); el `.env.example` falla a propósito hasta generar `AUTH_SECRET`. Elegir `astro/zod` para la configuración **no resuelve PEN-10** (validación de la API), que sigue abierto con `astro/zod` como candidato natural. Exigir https en producción para `APP_ORIGIN` no está decidido (PEN-12). `astro preview` quedó **roto** (Node no carga `.env` y cada petición devolvía 500), por eso `bun run preview` ahora ejecuta `scripts/start.ts`; lanzar `bun ./dist/server/entry.mjs` directamente se salta la validación previa (escucha y responde 500 por petición), así que el único arranque soportado es `bun run start`. Node 22.23.4 no se probó.
Fecha: 2026-11-22

### ADR-018 — Formato, lint y accesibilidad estática
Estado: confirmada
Contexto: la issue #5 pide formateador y linter compatibles con Astro, React y TypeScript, accesibilidad básica en JSX y base para la CI (issue #10). El responsable pidió registrarlo como "ADR-015"; ese número ya existe (versiones del stack), y el 016 y el 017 también, por lo que se usa el siguiente libre.
Decisión: Prettier 3.10.1 + prettier-plugin-astro 1.1.2 (formato) y ESLint 10.15.0 (flat config) + typescript-eslint 8.73.0 + eslint-plugin-astro 3.2.1 + eslint-plugin-jsx-a11y-x 0.2.0 (lint y accesibilidad nivel `recommended` en plantillas Astro y en `.tsx`). Se añaden, justificados, `@eslint/js` 10.0.1 y `globals` 17.14.0 (ESLint no los instala: reglas base y globales de Node/navegador). Todo exacto, sin `^`. Scripts `format`, `format:check` y `lint` (`--max-warnings 0`). `printWidth` 100 y `endOfLine: "lf"` con `.gitattributes` (`* text=auto eol=lf`); `docs/`, `*.md` y `bun.lock` fuera del formato. El campo `engines` de Node pasa a `^22.23.4 || ^24.16.0 || >=26.3.0` (intersección de Astro, ESLint y `eslint-plugin-astro`). Reglas no type-aware; sin desactivar reglas globalmente (excepciones puntuales con motivo).
Verificado: con temporales, `lint` detecta `label` sin control y `img` sin `alt` en `.tsx` y en `.astro` y una directiva `eslint-disable` sin uso; un warning hace fallar con `--max-warnings 0`; en un `git clone` real con `core.autocrlf=true`, el checkout queda en LF (0 archivos CRLF), `bun install --frozen-lockfile` no cambia el lockfile y `format:check` y `lint` salen con 0, y un archivo CRLF commiteado lo detecta `format:check` (antes, con `endOfLine: "auto"` y sin `.gitattributes`, un colaborador con `core.autocrlf=false` podía commitear CRLF sin aviso). Tras la revisión independiente se corrigió que el frontmatter de `.astro` no recibía las reglas base ni de TypeScript (un frontmatter con `any`, `debugger` y variables sin usar salía con 0): se verificó en rojo y en verde. El lint halló un caso real (`preserve-caught-error` en `astro.config.mjs`), corregido con `cause`, sin filtrar valores.
Alternativas consideradas: Biome (en `.astro` solo cubre el frontmatter, soporte experimental); ESLint 9 + `eslint-plugin-jsx-a11y` clásico 6.10.2 (compatible, pero versiones mayores anteriores que habría que migrar); `eslint-config-prettier` (no hace falta: no hay reglas estilísticas activas).
Consecuencias: **`typescript-eslint` 8.73.0 admite TypeScript `>=4.8.4 <6.1.0`; nuestra versión 6.0.3 es compatible, pero cualquier subida a TypeScript 6.1 o superior debe verificar primero la compatibilidad.** `eslint-plugin-jsx-a11y-x` es una versión 0.x (riesgo de cambios). La accesibilidad estática no garantiza que cada `<input>` tenga nombre accesible: los controles de formulario sin nombre accesible o con `for`/`htmlFor` a un `id` inexistente no se detectan estáticamente; se requieren pruebas E2E con axe, **aún sin planificar ni asignar a ninguna issue** (PEN-13). Node: `eslint-plugin-astro` exige `^22.22.3 || ^24.16.0 || >=26.3.0`; la CI debe usar una versión compatible. El formato inicial tocó solo `astro.config.mjs` y `src/lib/config.ts`.
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
