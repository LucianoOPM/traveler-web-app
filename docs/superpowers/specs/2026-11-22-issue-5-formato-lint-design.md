# Issue #5 — Formato y lint (diseño)

**Aprobado por el responsable en la conversación (2026-11-22): opción 1 con las 7 decisiones confirmadas.** Tamaño: cambio pequeño-mediano (configuración + formateo inicial + documentación).

## Intención
Un formato y un lint consistentes y reproducibles para `.astro`, `.tsx` y `.ts`, con accesibilidad estática básica en JSX y plantillas, y una base lista para la CI de la issue #10. Criterio de aceptación: `bun run lint` y `bun run format:check` pasan en un clon limpio.

## Metas
- Formato: Prettier 3.10.1 + prettier-plugin-astro 1.1.2.
- Lint: ESLint 10.15.0 (flat config) + typescript-eslint 8.73.0 + eslint-plugin-astro 3.2.1 + eslint-plugin-jsx-a11y-x 0.2.0, accesibilidad en nivel `recommended` para plantillas Astro y para `.tsx`.
- Scripts `format`, `format:check`, `lint` (este último con `--max-warnings 0`).
- Reformateo inicial de los archivos existentes (commit separado para poder revisar el diff).
- Documentación en la guía de desarrollo y **ADR-018** (el responsable pidió "ADR-015"; ese número ya existe y el 017 también, por eso se usa el siguiente libre).

## No metas
Type-aware linting, `eslint-plugin-react`/`react-hooks`, `eslint-config-prettier`, Biome, hooks de pre-commit, CI (issue #10), formatear `docs/`, pruebas E2E de accesibilidad (axe, issue #7/H8).

## Anti-metas
Desactivar reglas globalmente; que el reformateo mezcle cambios de lógica; que falle en un clon limpio de Windows por saltos de línea.

## Restricciones y hechos verificados
- Versiones exactas (sin `^`/`~`); TypeScript sigue en 6.0.3: `typescript-eslint` 8.73.0 admite TypeScript `>=4.8.4 <6.1.0`. **Subir a TypeScript 6.1+ exige verificar antes la compatibilidad** (se anota en ADR-018).
- `eslint-plugin-astro` 3.2.1 exige ESLint >= 10 y Node >= 22.22.3; recomienda `eslint-plugin-jsx-a11y` o `-x` (el clásico 6.10.2 declara ESLint hasta 9: incompatible; `-x` 0.2.0 acepta 9 y 10 pero es 0.x).
- Paquetes auxiliares **justificados** (no estaban en la lista): `@eslint/js` 10.0.1 (reglas base `js.configs.recommended`, no viene con ESLint) y `globals` 17.14.0 (globales de Node/navegador para `.mjs`; no se instala solo). Ambos exactos.
- Prettier lee `.gitignore` por defecto (ignora `dist/`, `.astro/`, `.env`, `storage/`). Exit codes: 0 ok, 1 sin formato, 2 error.
- Git en Windows avisa de conversión LF→CRLF al hacer checkout: Prettier con `endOfLine` por defecto (`lf`) fallaría en un clon limpio; se usa `endOfLine: "auto"`.
- Sin Python. Commits en Conventional Commits. Rama `chore/h0-formato-lint`; PR a `dev` con `Closes #5` (ADR-016).

## Enfoques
1. **Prettier + ESLint con plugin Astro (elegido):** cubre frontmatter y plantillas de `.astro`, `.tsx`, `.ts`.
2. **Biome:** descartado; en `.astro` solo cubre el frontmatter (experimental).
3. **ESLint 9 + jsx-a11y clásico:** descartado; versiones mayores anteriores que habría que migrar.

## Decisiones tomadas (mías, a revisar)
- `printWidth: 100` (el código existente usa líneas de hasta ~100); resto, valores por defecto de Prettier.
- `.prettierignore`: `docs/` (no se reformatea la documentación en prosa y tablas), `bun.lock`.
- Solo reglas recomendadas no type-aware (`tseslint.configs.recommended`); `linterOptions.reportUnusedDisableDirectives: "error"`.
- Excepciones solo puntuales: `// eslint-disable-next-line <regla> -- <motivo>`; ESLint no puede imponer el motivo sin otro plugin, se exige por convención y revisión.
- **Límite documentado:** la accesibilidad estática detecta, por ejemplo, `<label>` sin control asociado (`label-has-associated-control`) o `<img>` sin `alt`, pero no puede garantizar que todo `<input>` tenga nombre accesible; eso se cubrirá con E2E/axe.

## A cargo del constructor
Forma exacta de las configs de `eslint-plugin-jsx-a11y-x` para `.tsx` (Context7 no la documenta: leer el README del paquete instalado y registrar un `Ruling:`); arreglos mínimos en el código existente para que `lint` pase sin desactivar reglas; redacción de la guía y del ADR.
