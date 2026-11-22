# Issue #2 — Inicializar proyecto Astro + React islands con Bun (diseño corto)

**Aprobado por el responsable en la conversación (2026-11-22).** Tamaño: cambio pequeño.

## Intención
Tener un proyecto Astro en modo servidor con islands React que arranque desde un clon limpio, sobre el que se construyan el resto de las issues de H0 y H1. Criterio de aceptación de la issue: `bun install && bun run dev` funciona desde un clon limpio.

## Metas
- Astro en `output: 'server'` con adaptador Node `standalone` e integración React.
- TypeScript estricto **comprobado** (`astro check`), no solo configurado.
- Versiones exactas (sin `^`/`~`) en `package.json` y `bun.lock` commiteado.
- Página mínima con una island React y scripts `dev`, `build`, `preview` (más `check`).

## No metas
Drizzle, PostgreSQL/Docker y Better Auth (H1); estructura de carpetas, `.gitignore` extendido y storage (issue #3); lint/formato (#5); pruebas (#7).

## Anti-metas
Que `dev` funcione solo "por casualidad" (versiones flotantes) o que `strict` no se compruebe nunca.

## Restricciones
- Versiones del ADR-015: Astro 7.4.13, @astrojs/node 11.1.14, @astrojs/react 7.1.9, React y react-dom 19.3.1; Bun 1.4.4; Node >= 22.23.4.
- Sin Python; solo Bun/Node/bash. Commits en Conventional Commits; PR hacia `dev` con `Closes #2` (ADR-016).
- Lo que Context7 documenta (Astro 7): `adapter: node({ mode: 'standalone' })`; scripts `astro dev|build|preview`; tsconfig con `extends: astro/tsconfigs/strict`, `include: [".astro/types.d.ts", "**/*"]`, `exclude: ["dist"]`, `jsx: react-jsx`, `jsxImportSource: react`; React sin `compiler` (no requiere `oxc-transform-react`); `astro check` requiere `@astrojs/check` + `typescript`.

## Enfoques
1. **Scaffold manual con `bun add --exact` (elegido):** solo las dependencias necesarias, versiones exactas desde el inicio.
2. **`bun create astro` (plantilla oficial):** descartado; arrastra archivos y dependencias que luego habría que borrar y pinea con `^`.

## Decisiones tomadas
- `astro/tsconfigs/strict` (no `strictest`) para no ser más estrictos que Astro sin necesidad.
- Se añaden `typescript` y `@astrojs/check` (decisión del responsable). **Hallazgo:** `typescript` latest es 7.0.2 pero `@astrojs/check` 0.9.12 exige `typescript ^5 || ^6`; se fija **typescript 6.0.3** (última 6.x). Debe anotarse en ADR-015 y en la guía de desarrollo.
- `bun run dev` ejecuta la CLI de Astro con Node (Bun respeta el shebang); se prueba también con `bun --bun` y se documenta lo que ocurra.
- Se mantiene `output: 'server'` (el proyecto es full-stack; las páginas se renderizan bajo demanda).

## A cargo del constructor
Contenido exacto de la página y la island; `packageManager`/`engines` en `package.json`; ajuste del `.gitignore` mínimo (`node_modules/`, `dist/`, `.astro/`) si hace falta para no ensuciar el commit; comprobar `astro preview` con el adaptador Node (no confirmado por la documentación consultada).
