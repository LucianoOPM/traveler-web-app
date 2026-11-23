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
| ADR-023 | Migraciones solo hacia adelante con `drizzle-kit` (sin `down.sql` ni rollback), copia antes de migrar y protección de la base de pruebas | Confirmada |
| ADR-024 | Validación de entrada de la API con Zod desde `astro/zod` (sin dependencias nuevas): `z.strictObject` en escrituras, centavos con `z.int()`, errores solo con `path` y `message`; el helper llega con el primer endpoint de H2 (cierra PEN-10) | Confirmada |
| ADR-025 | Astro Actions para las operaciones internas (validación Zod, permiso en cada handler, adaptador `AppError` → `ActionError`); API Routes solo ante necesidad HTTP específica | Confirmada |
| ADR-026 | Servicios como clases con inyección por constructor (sin contenedor de DI); capas `domain`/`application`/`infrastructure` por módulo; transacciones desde el caso de uso | Confirmada |
| ADR-027 | Interfaz con Tailwind CSS v4 (`@tailwindcss/vite`) y shadcn/ui (componentes propios en `src/components/ui/`, solo en islands React); decidido, pendiente de instalar | Confirmada |

### ADR-015 — Versiones del stack y driver de PostgreSQL
Estado: confirmada
Decisión: versiones exactas (sin `^`) de Bun 1.4.4, Astro 7.4.13, @astrojs/node 11.1.14, @astrojs/react 7.1.9, React y react-dom 19.3.1, drizzle-orm 0.45.4, drizzle-kit 0.31.11, better-auth y @better-auth/drizzle-adapter 1.7.27, TypeScript 6.0.3 y @astrojs/check 0.9.12 (TypeScript 7 no: `@astrojs/check` exige `^5 || ^6`). La aplicación corre con Bun y usa `drizzle-orm/bun-sql`; `pg` 8.23.1 es devDependency solo porque `drizzle-kit migrate` la necesita. Estas versiones se probaron juntas en un proyecto desechable (build, servidor, `drizzle-kit` y registro con Better Auth).
Alternativas descartadas: Node + `pg` y Bun + `pg` (funcionan; se prefiere el driver nativo de Bun, ADR-002); Drizzle 1.0 RC (pre-release).
Consecuencias: subir versiones exige repetir la validación. El comportamiento de `bun-sql` con transacciones concurrentes (reservas atómicas, P0) se prueba en H3.
Fecha: 2026-11-22

### ADR-016 — Estrategia de ramas
Estado: confirmada
Decisión: `main` es la rama de despliegue y `dev` la predeterminada de desarrollo. Las ramas de trabajo (`feat/`, `fix/`, `chore/`, `docs/`) salen de `dev` y vuelven por PR. `dev` se fusiona a `main` por PR, con *merge commit*, cuando un hito esté listo o se vaya a desplegar. Los hotfix salen de `main` y se devuelven a `dev`. Los rulesets de GitHub de `dev` y `main` exigen PR **sin aprobaciones obligatorias** (un único responsable no puede aprobar sus propios PR), el check `verificar` (sin exigir rama actualizada) y bloquean force-push y borrado.
Consecuencias: `Closes #N` solo cierra issues al fusionar en `dev`; al fusionar `dev` → `main` hay que cerrar a mano las que queden. El despliegue desde `main` depende de PEN-08.
Fecha: 2026-11-22

### ADR-017 — Validación de configuración de entorno
Estado: confirmada (simplificada el 2026-11-22)
Contexto: la aplicación no debe arrancar con configuración inválida ni filtrar secretos al cliente, a logs o al build (`import.meta.env.X` incrusta el valor del `.env` en `dist/`).
Decisión: una función `comprobarConfiguracion(env)` en `src/lib/config.ts` (sin Zod, sin objeto `Config`, sin caché) llamada desde `astro.config.mjs` (dev y build) y `scripts/start.ts` (producción, antes de escuchar). Las variables se leen con `process.env`.
Alternativas descartadas: `env.schema` de Astro — se probó el 2026-11-22: con `validateSecrets: true` un build sin `DATABASE_URL` o con `BETTER_AUTH_SECRET` corto termina con código 0 y el servidor arranca sin validar, además de no expresar reglas entre variables; validar solo en el middleware (arrancaría con configuración inválida).
Consecuencias: `bun run dev` y `bun run build` exigen un `.env` válido; `.env.example` falla a propósito hasta generar `BETTER_AUTH_SECRET`. Esto no resuelve la validación de la API (PEN-10, resuelto en ADR-024).
Fecha: 2026-11-22

### ADR-018 — Formato, lint y accesibilidad estática
Estado: confirmada
Decisión: Prettier 3.10.1 + prettier-plugin-astro 1.1.2 (formato; `printWidth` 100, `endOfLine: "lf"` y `.gitattributes` con `eol=lf`) y ESLint 10.15.0 (flat config) con typescript-eslint 8.73.0, eslint-plugin-astro 3.2.1 y eslint-plugin-jsx-a11y-x 0.2.0 (accesibilidad `recommended` en `.astro` y `.tsx`), más `@eslint/js` y `globals`. Reglas sin análisis de tipos (los comprueba `astro check`), `--max-warnings 0`, sin desactivar reglas globalmente. `engines` de Node `^22.23.4 || ^24.16.0 || >=26.3.0`.
Consecuencias: typescript-eslint 8.73.0 admite TypeScript `<6.1.0`; verificar antes de subir TypeScript. `jsx-a11y-x` es 0.x. El lint estático no detecta controles de formulario sin nombre accesible; haría falta una prueba E2E con axe cuando exista una interfaz real (PEN-13).
Fecha: 2026-11-22

### ADR-019 — Errores tipados y respuestas uniformes
Estado: confirmada (simplificada el 2026-11-22; su formato rige en API Routes, las Actions usan `ActionError`: ver ADR-025)
Decisión: `src/lib/errors.ts` define `AppError` y siete subclases (400, 401, 403, 404, 409, 422, 500) con código `snake_case`. `src/middleware.ts` envuelve `next()` en un `try/catch` (en un middleware de Astro `next()` rechaza con el valor lanzado original) y, solo para rutas `/api/`, `toErrorResponse` (`src/lib/error-response.ts`) devuelve `{ error: { code, message } }`. `InternalError` y cualquier otro valor lanzado son inesperados: `500 internal_error` con mensaje genérico y una línea de registro con `errorName`, `method` y `path` (nunca mensaje, `cause`, query ni cabeceras; en desarrollo se imprime el error completo).
Consecuencias: el `message` de un `AppError` es público y su autor responde de que sea seguro; los `404`/`405` de rutas `/api/` inexistentes siguen con el formato de Astro; no hay `requestId` ni biblioteca de logging; 429 queda reservado. Límite: un error lanzado tras empezar una respuesta en streaming no lo captura el middleware.
Fecha: 2026-11-22

### ADR-020 — Runner de pruebas: `bun test`
Estado: confirmada
Decisión: `bun test` sin dependencias nuevas ni `bunfig.toml`. Scripts `test:unit` (`bun test ./tests/unit`), `test:integration` (`bun test ./tests/integration`) y `test` (ambos en secuencia). El `./` es necesario: sin él, `bun test` trata el argumento como filtro por subcadena y recoge rutas ajenas.
Alternativas descartadas: Vitest (más dependencias y configuración; ningún código lo exige hoy), Jest y `node:test` (un segundo runner sin ventaja).
Consecuencias: los módulos virtuales `astro:*` no se pueden importar en `bun test`; por eso las pruebas de integración usan el proyecto de `tests/fixtures/api-errors/`. Si hiciera falta probar código con `astro:*` sin fixture, reconsiderar Vitest.
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

### ADR-023 — Migraciones solo hacia adelante con Drizzle
Estado: confirmada (reemplaza la versión del 2026-11-22 con `down.sql` y ejecutor de rollback)
Contexto: `drizzle-kit` genera migraciones hacia adelante y no tiene reversa. La primera versión de este ADR añadió `down.sql`, un ejecutor de rollback con hash y marcador de irreversibilidad y una guardia; para el tamaño del proyecto era más código que el que se quería proteger.
Decisión:
1. **Solo hacia adelante.** Migraciones con `drizzle-kit generate` y `drizzle-kit migrate`; se corrige con una migración nueva. Sin `down.sql`, rollback, hashes ni marcadores.
2. **Copia antes de migrar** si la migración puede afectar datos existentes (`pg_dump`, ver la guía).
3. **Pruebas:** `traveltech_test` se recrea cuando hace falta. Toda operación destructiva de pruebas llama antes a `asegurarBaseDePruebas`, que comprueba `current_database()` en la propia conexión (cierra PEN-15).
4. **Una sola config:** `drizzle.config.ts` usa `DATABASE_URL`; con `BASE=demo` usa `DEMO_DATABASE_URL`. La demo recibe las mismas migraciones y esquema que la privada (REC-001).
5. **Drizzle hace siempre las migraciones; Better Auth nunca** (regla del responsable, 2026-11-22): no se usa `auth migrate`; a lo sumo `auth generate` para obtener el esquema de Drizzle, que se revisa y se versiona.
6. Driver de la aplicación `bun-sql`; `pg` es dependencia de desarrollo solo porque `drizzle-kit` la necesita.
Consecuencias: **versión y relaciones.** Se usa la línea estable `latest` de npm (`drizzle-orm` 0.45.4 y `drizzle-kit` 0.31.11; no existe una etiqueta LTS y 1.0 sigue en beta/RC: `1.0.0-rc.6` el 2026-11-22). La documentación de 1.0 indica que **cambian las relaciones**: 0.45.x usa `relations()` por tabla (consultas relacionales v1: `fields`/`references`, pasadas a `drizzle()` junto con el esquema), mientras que 1.0 elimina esa API y usa `defineRelations` en un solo lugar (consultas relacionales v2: `r.one`/`r.many`, `from`/`to`, `through` para muchos a muchos), y además amplía `__drizzle_migrations` con `name` y `applied_at` y empareja las migraciones por nombre de carpeta. Para contemplarlo: el código declara relaciones solo en archivos `relations.ts` de cada módulo y la conexión sigue siendo el único punto que las pasa a `drizzle()` (`src/db/conexion.ts`); así subir a 1.0 reescribe esos archivos y revisa `rollback.ts` (depende de `created_at`/`hash` y del layout `NNNN_<nombre>.sql` + `.down.sql`), sin tocar el resto. Subir de versión exige un ADR nuevo y repetir la validación. Además, `bun-sql` tiene limitaciones documentadas por Drizzle (`json`/`jsonb` hacen un `JSON.stringify` extra, `timestamp` con `mode: "string"` puede fallar y los `array` tienen problemas): evitar esos tipos o probarlos antes de usarlos.
Fecha: 2026-11-22

### ADR-024 — Validación de entrada de la API con `astro/zod`
Estado: confirmada (cierra PEN-10; dentro de Actions la validación la hace la propia Action, ver ADR-025)
Contexto: los endpoints de H2 en adelante reciben cuerpos, parámetros y consultas del cliente y hay que validarlos en el servidor. La validación de la configuración de entorno (ADR-017) es propia y no cambia.
Decisión:
1. **Biblioteca:** Zod 4 importado siempre desde `astro/zod`, la reexportación oficial que usa Astro (hoy Zod 4.6.7). No se añade ninguna dependencia ni se importa `zod` directamente.
2. **Convenciones de esquema:**
   - Cuerpos de escritura con `z.strictObject()`: un campo desconocido (`role`, `database`, `demoMode`…) se rechaza, no se ignora en silencio.
   - Importes en centavos con `z.int()` (nunca `z.number()`: los floats no son dinero).
   - Identificadores con `z.uuid()`.
   - Instantes con `z.iso.datetime()` (UTC).
3. **Errores:** un fallo de Zod se traduce a `ValidationError` (ADR-019) con `details: [{ field, message }]`, donde `field` es el `path` unido por puntos. Nunca se serializan `input` ni valores enviados por el cliente. Los mensajes por defecto de Zod no incluyen lo recibido (comprobado con 4.6.7: solo tipos y opciones esperadas); los mensajes personalizados son responsabilidad de quien los escribe, como manda el ADR-019.
4. **Idioma:** base `z.locales.es()` aplicada una sola vez (`z.config` es global), con mensajes propios donde la redacción automática no sirva (p. ej. «Inválido dirección de correo electrónico»).
5. **Helper diferido:** la función que convierte un error de Zod en `ValidationError` **no existe aún**. Se escribe y se prueba contra una ruta real junto con el primer endpoint de H2 (sin infraestructura sin consumidor).
Alternativas consideradas: importar `zod` directamente (habría que fijar la versión y podrían convivir dos Zod); Valibot o ArkType (otra dependencia sin ventaja que justifique el costo en un monolito pequeño); validar a mano (más código y más riesgo de omisiones).
Consecuencias: `astro/zod` sube con Astro: subir de versión mayor de Zod exige revisar este ADR. Si Astro dejara de reexportarlo habría que declarar `zod` como dependencia. `z.object` ignora campos desconocidos, por eso las escrituras usan `z.strictObject`.
Fecha: 2026-11-22

### ADR-025 — Astro Actions para las operaciones internas
Estado: confirmada
Contexto: H2 y los hitos siguientes necesitan operaciones de escritura desde el panel y los formularios. El ADR-024 las planteaba como rutas `/api/v1/` con un helper de validación; Astro Actions validan la entrada con Zod, dan tipos de extremo a extremo y evitan una API REST paralela.
Decisión:
1. **Mecanismo principal:** las operaciones internas y de formulario (CRUD de catálogo, reservas, pagos, revisión, abordaje…) son Astro Actions en `src/actions/` (un archivo por módulo, agrupadas en `src/actions/index.ts`). No hay una API REST paralela para lo que ya cubren.
2. **Lecturas de página** (catálogo público, panel): SSR que llama a los servicios directamente en el servidor, sin Action ni API.
3. **API Routes solo ante una necesidad HTTP específica:** servir archivos privados, validar QR desde clientes externos, integraciones, Better Auth (`/api/auth/*`, sin cambios) y `/api/health`.
4. **Una Action** valida la entrada (`input` con Zod, ADR-024), verifica sesión y permiso, invoca el servicio y devuelve el resultado. No contiene reglas de negocio: esas viven en servicios y dominio, que siguen comprobando sus invariantes (la validación de forma de Zod no las sustituye).
5. **Autorización:** las Actions son endpoints públicos (`/_actions/<nombre>`). El middleware resuelve la sesión también en `/_actions/` y la deja en `locals`, pero **cada handler comprueba el permiso**; ninguna Action se supone privada. Cada Action se prueba con peticiones directas: sin sesión (`401`) y con rol insuficiente (`403`).
6. **Errores:** Astro convierte cualquier error no controlado de un handler en `INTERNAL_SERVER_ERROR` **con el mensaje del error original** (verificado en Astro 7.4.13, `callSafely`), lo que rompería el ADR-019. Toda Action pasa por un único adaptador `AppError` → `ActionError`: conserva el mensaje público (`400` `BAD_REQUEST`, `401` `UNAUTHORIZED`, `403` `FORBIDDEN`, `404` `NOT_FOUND`, `409` `CONFLICT`, `422` `UNPROCESSABLE_CONTENT`) y responde un mensaje genérico para `InternalError` y errores inesperados, con el mismo registro mínimo del ADR-019. Se escribe con la primera Action (paquetes) junto con la prueba de que un error inesperado no filtra su mensaje.
7. **CSRF:** Astro comprueba `Origin` en peticiones de formulario (`security.checkOrigin`, activo por defecto, también al despachar Actions); las Actions JSON dependen del preflight CORS del navegador y de la cookie de sesión `SameSite=Lax` de Better Auth. No se desactiva `checkOrigin`.
Alternativas consideradas: API REST `/api/v1/` (duplica validación y tipos); tRPC u otra librería RPC (dependencia nueva sin necesidad).
Consecuencias: las respuestas de `/_actions/*` usan `ActionError`/`ActionInputError`, no el JSON `{ error: { code, message } }` del ADR-019, que se mantiene en las API Routes. `ActionError` solo admite sus códigos HTTP y descarta propiedades extra: el código estable de un `AppError` (p. ej. `capacity_exceeded`) no llega al cliente; si una pantalla debe ramificar por él, la Action devuelve el resultado como dato (se decide en esa issue). Los errores de entrada traen `fields` (solo el primer segmento del `path`) e `issues`; un campo desconocido en un `z.strictObject` produce un error sin `fields` (`path` vacío), y la interfaz muestra el mensaje general. El helper «Zod → `ValidationError`» del ADR-024 solo aplica a API Routes con cuerpo y no se escribe mientras no exista una. Subir de versión de Astro exige revisar este ADR.
Fecha: 2026-11-22

### ADR-026 — Servicios como clases con inyección por constructor
Estado: confirmada
Contexto: la lógica de negocio de H2 en adelante coordina repositorios, transacciones y reglas. Se quiere que sea comprobable con dependencias falsas sin añadir un framework.
Decisión:
1. **Capas por módulo** (`src/modules/<módulo>/`): `domain/` (reglas, invariantes, cálculos y transiciones; funciones puras cuando basten, y las interfaces de repositorio), `application/` (servicios: clases que implementan casos de uso, coordinan dependencias y gestionan transacciones), `infrastructure/` (repositorios Drizzle y adaptadores) y `container.ts` (factory que construye repositorios y servicios). Cada módulo conserva su `schema.ts` y `relations.ts` (ADR-023), compuestos en `src/db/schema.ts`. La estructura es orientativa: se respeta la organización ya existente (`identity`).
2. **Inyección por constructor**, sin contenedor de DI, decoradores ni librerías (Inversify, NestJS). Se definen interfaces solo para dependencias que de verdad necesiten abstracción (sobre todo repositorios); no se crean interfaces, factories ni clases «por si acaso». Funciones donde la lógica sea simple y pura.
3. **Sin conexión global en los servicios:** reciben sus dependencias por constructor. La conexión se crea en la composición a partir de la base elegida en el servidor, nunca desde el cliente (invariante de demo).
4. **Transacciones:** las coordina el caso de uso. Una operación de negocio atómica es una sola transacción en la que pueden participar varios repositorios (construidos sobre el mismo ejecutor `db`/`tx`); no se abren transacciones independientes dentro de ella. Las restricciones de la base siguen siendo la última defensa. El mecanismo concreto para que un servicio obtenga repositorios ligados a `tx` se fija con el primer caso de uso que lo necesite; en H3 a H5 inventario, pagos y abordaje añaden la concurrencia adecuada (locks o actualizaciones condicionales, ver [05-business-rules](../02-diseno/05-business-rules.md)).
5. **Pruebas:** reglas puras con pruebas unitarias; servicios con pruebas unitarias y repositorios falsos o en memoria; repositorios y transacciones con integración sobre PostgreSQL real (`traveltech_test`); permisos de las Actions con peticiones directas no autorizadas. Sin mocks excesivos ni abstracciones creadas solo para probar.
Alternativas consideradas: módulos de funciones que importan la base (dependencia implícita, más difícil de sustituir en pruebas); un contenedor de DI (complejidad sin beneficio a este tamaño); Clean Architecture completa (capas innecesarias).
Consecuencias: más archivos por módulo que con funciones sueltas; se compensa creando las carpetas solo cuando reciben su primer archivo, como ya hace la guía. Los repositorios no toman decisiones de permisos: la autorización vive en la Action.
Fecha: 2026-11-22

### ADR-027 — Tailwind CSS v4 y shadcn/ui para la interfaz
Estado: confirmada (decisión de adopción; **aún no instalado**, se implementa en una issue aparte)
Contexto: hasta #53 las pantallas usan HTML semántico y un `<style>` mínimo por layout, sin sistema de estilos ni de componentes (ningún documento lo decidía). Lo que sigue (catálogo público, reservaciones, pagos, boletos y escáner de abordaje en móvil) necesita formularios, tablas, diálogos y una interfaz coherente y accesible; escribir y mantener ese CSS a mano no es la solución más sencilla.
Decisión:
1. **Tailwind CSS v4** con el plugin de Vite `@tailwindcss/vite` (la vía oficial de Astro: `astro add tailwind`), añadido a `vite.plugins` en `astro.config.mjs`. No se usa `@astrojs/tailwind` ni `tailwind.config.js` (son de Tailwind 3). Hoja única `src/styles/global.css` con `@import "tailwindcss"`, importada desde los layouts; el tema se define con variables CSS (`@theme`). Versiones verificadas el 2026-11-23: `tailwindcss` y `@tailwindcss/vite` 4.3.5 (su peer `vite` admite `^5.2 || ^6 || ^7 || ^8`; el proyecto usa Vite 8.3.8).
2. **shadcn/ui** como código propio: el CLI copia los componentes a `src/components/ui/` y desde ahí se versionan y se modifican como el resto. Se añade el alias `@/*` → `./src/*` en `tsconfig.json` y un `components.json` con `tailwind.config` vacío (Tailwind 4). El CLI (`shadcn`, 4.23.0 el 2026-11-23) se fija como dependencia de desarrollo o se ejecuta con versión exacta. Las dependencias de ejecución que añada `init` según el estilo elegido (utilidad `cn` con `clsx` 2.1.1, `tailwind-merge` 3.7.1 y `class-variance-authority` 0.7.1; iconos `lucide-react` 1.78.0; primitivas Radix o Base UI) se fijan **exactas** (ADR-015); las versiones se vuelven a comprobar al instalar.
3. **Frontera:** los componentes de shadcn se usan solo dentro de islands React (`.tsx`). Páginas y layouts Astro usan clases de Tailwind directamente; no se crean componentes `.astro` espejo. No cambia nada de las reglas P0: los islands siguen sin guardar secretos, sin autorizar y sin lógica financiera.
4. **Una sola fuente de estilos:** al migrar una pantalla se eliminan sus `<style>` y estilos propios; no se mezcla CSS plano con utilidades en la misma pantalla.
5. **Calidad sin excepciones globales:** Prettier, ESLint (incluido `jsx-a11y`, ADR-018), `astro check`, pruebas y build de CI siguen aplicándose también a `src/components/ui/`. Un componente generado que incumpla una regla se corrige o se exceptúa de forma puntual y con motivo, nunca desactivando la regla en toda la configuración.
6. **Alcance de este ADR:** solo decide. No instala nada ni migra pantallas. La issue de implementación instala y configura Tailwind y shadcn, migra login, layout administrativo y las pantallas de #53, y actualiza guía y estado. Conviene hacerla **antes del catálogo público (#54)** para no construirlo dos veces.
Alternativas consideradas: seguir con CSS plano (no escala a formularios, tablas, diálogos y flyers, y obliga a reinventar accesibilidad); Bootstrap o DaisyUI (estilos opinados, más costoso de personalizar y sin componentes React accesibles); MUI, Mantine o Chakra (bibliotecas con runtime en React que no sirven en páginas Astro y pesan más); solo primitivas de Radix sin shadcn (más trabajo de estilo sin ventaja).
Consecuencias: Tailwind 4 está pensado para Safari 16.4+, Chrome 111+ y Firefox 128+ y no funciona en navegadores anteriores (documentación de Tailwind): comprobar los dispositivos del personal antes de H5 (escáner de abordaje en móvil). Tailwind usa capas de CSS (`@layer`): los estilos sin capa, como un `<style>` de Astro, ganan a las utilidades, por eso el punto 4. Los componentes copiados no se actualizan solos: actualizarlos es una tarea manual (`shadcn add` y revisar el diff). Aumentan las dependencias y el código a mantener. La accesibilidad real de los componentes sigue sin probarse en navegador hasta PEN-13.
Fecha: 2026-11-23

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
| Una Action devuelve al cliente el mensaje de un error inesperado (comportamiento de Astro 7.4.13) | Adaptador único `AppError` → `ActionError` con mensaje genérico y prueba de que no filtra (ADR-025) |
| Tratar una Action como privada por estar en el servidor | Cada handler comprueba el permiso y se prueba con peticiones directas sin sesión y con rol insuficiente (ADR-025) |

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
