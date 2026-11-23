# Issue #10 — CI en GitHub Actions para validar instalación limpia (diseño)

**Aprobado por el responsable en la conversación (2026-11-22)**, con estas precisiones: `AUTH_SECRET` ficticio, válido y determinista solo para CI; acciones con etiqueta mayor en H0 (fijado por SHA como mejora posterior); `actionlint` no obligatorio, se documenta como mejora posterior; rulesets sin tocar hasta ver ambos jobs pasar en un PR hacia `dev` y, entonces, solo con su aprobación expresa; aceptación inicial = ambos jobs pasan en un PR hacia `dev` (validación en `main` pendiente de `dev → main`, cierre de H0). Tamaño: cambio pequeño-mediano (un workflow, un script de validación de rango de commits con pruebas y documentación). Rama: `chore/h0-ci`, desde `dev`.

## Intención
Que cada PR y cada push a `dev`/`main` demuestre, en un entorno limpio y sin secretos reales, que el proyecto se instala de forma reproducible y pasa formato, lint, tipos, pruebas y build, y que los commits del PR cumplen Conventional Commits (validación obligatoria en el servidor que la issue #9 dejó para esta).

## Metas
- `.github/workflows/ci.yml` con dos jobs de nombre estable (`verificar` y `commits`), pensados para añadirse después como checks requeridos.
- `verificar`: instalación con `bun install --frozen-lockfile`, `format:check`, `lint`, `check`, `test` y `build`.
- Caché de dependencias de Bun.
- `commits` (solo en PR): valida la cabecera de cada commit del rango del PR reutilizando `validarMensaje(..., { ignorarComentarios: false })`.
- Documentación: ADR-022, guía de desarrollo, `docs/00-estado.md` y la nota de `commit-msg` sobre el servidor.

## No metas
Despliegue o CD; matriz de sistemas operativos o versiones de Node; E2E; análisis de seguridad o dependabot; validar el título del PR (con merge commits, ADR-016, no pasa a ser un mensaje de commit); servicios (PostgreSQL) en CI, que aún no existen; cambiar los rulesets de GitHub sin confirmación expresa.

## Anti-metas
Que la CI use o exija un secreto real; que se interpole texto controlado por el autor del PR dentro de un `run:` (inyección); que un cambio de `bun.lock` pase en silencio; que el workflow tenga más permisos que `contents: read`.

## Hechos verificados (2026-11-22)
- `astro build` valida la configuración y rechaza el `AUTH_SECRET` de `.env.example` (marcador); `astro check` y las pruebas no necesitan `.env`.
- `setup-bun` lee `packageManager` de `package.json` (hoy `bun@1.4.4`) sin configuración; su caché guarda solo el binario de Bun, no las dependencias (Context7, `oven-sh/setup-bun`).
- `setup-node` admite versión exacta; la guía solo validó Node v24.22.0.
- Últimas versiones publicadas (GitHub): `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/cache` v6.1.0, `oven-sh/setup-bun` v2.2.0.
- El historial sin merges cumple el formato salvo el commit inicial `init`; los merges de GitHub pasan por la excepción `Merge `.
- Rulesets activos: `proteger-dev` y `proteger-main` (hoy sin checks requeridos).

## Decisiones tomadas (del responsable)
- Incluir en esta issue la validación de commits del PR (respuesta del 2026-11-22).
- Valores de entorno ficticios, sin secretos reales (de la issue).

## Decisiones mías (a revisar)
- **Disparadores:** `pull_request` hacia `dev` y `main`, y `push` a `dev` y `main`. Concurrencia por rama; se cancela la ejecución anterior solo en PR.
- **Permisos y límites:** `permissions: contents: read`; `timeout-minutes` en cada job.
- **Versiones:** Bun la del `packageManager` (sin duplicarla); Node **24.22.0** exacta (la validada). Acciones fijadas a la etiqueta mayor (`@v7`, `@v6`, `@v2`).
- **Caché:** `actions/cache` sobre `~/.bun/install/cache`, clave `bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}`. Con `--frozen-lockfile` el lockfile sigue siendo la fuente de verdad: la caché solo acelera.
- **Entorno de `build`:** variables ficticias en el `env:` solo de ese paso, copiadas de `.env.example` salvo `AUTH_SECRET`, que lleva un valor de 32+ caracteres que no es el marcador, y `NODE_ENV=production`. Sin `.env` en el repositorio.
- **Orden de pasos:** `format:check` → `lint` → `check` → `test` → `build` (de más barato a más caro).
- **Validación de commits:** nuevo `scripts/validar-commits.ts` con una función pura `validarCommits(commits)` (lista de `{ sha, mensaje }` → lista de errores) y un CLI `bun scripts/validar-commits.ts <base> <head>` que lee `git log --format=%H%x00%B%x1e <base>..<head>`. El workflow pasa `base.sha` y `head.sha` por variables de entorno (no interpoladas en el `run:`) y usa `fetch-depth: 0`. Los merges se aceptan por el prefijo `Merge ` que ya admite el validador. El error lista cada commit inválido con su SHA corto y el motivo.
- **Pruebas del validador:** unitarias de `validarCommits` y una de integración con un repositorio Git temporal real (rango con commits válidos, uno inválido y un merge).
- **Checks requeridos:** se propone añadir `verificar` y `commits` a los rulesets después de ver el workflow pasar en un PR; no se tocan los rulesets sin su confirmación.
- **ADR-022** registra la decisión (la 016 es la estrategia de ramas; la 020 y la 021, pruebas y commits) y se añade una nota al ADR-016 sobre los checks requeridos.

## Enfoques
1. **Un workflow con dos jobs y script propio para commits (elegido):** reutiliza el validador existente, sin dependencias nuevas y con nombres de check estables. Los jobs corren en paralelo.
2. **Acción de terceros para commits (commitlint action o similar):** menos código propio, pero añade una dependencia externa y reglas distintas a las ya decididas en ADR-021.
3. **Un único job secuencial:** más simple, pero un commit mal escrito esperaría al build completo y no se podría exigir cada check por separado.

## Verificación y límites
- Se verifica localmente en un clon limpio, sin `.env`, con el entorno saneado, ejecutando exactamente los comandos del workflow, y en GitHub con el PR de esta rama.
- El criterio "el workflow pasa en `main`" solo se puede comprobar cuando `dev` se fusione en `main` (cierre de H0); hasta entonces se demuestra en el PR hacia `dev`. No se afirmará lo contrario.
- No hay `actionlint` instalado; la validación sintáctica real es la primera ejecución en GitHub.

## A cargo del constructor
Redacción exacta del workflow y del mensaje de error de commits, nombres de variables, detalles de las pruebas con Git temporal y redacción del ADR y de las guías.
