# Issue #3 — Estructura de carpetas, .gitignore y storage privado (diseño corto)

**Aprobado por el responsable en la conversación (2026-11-22).** Tamaño: cambio pequeño.

## Intención
Dejar el esqueleto de carpetas que fija `docs/04-ingenieria/09-development-guide.md` (sección Estructura) para que las issues siguientes de H0 y H1 tengan dónde vivir, y asegurar que secretos y archivos privados nunca entren al repositorio. Criterio de aceptación: la estructura coincide con la guía y `git status` no muestra secretos ni storage.

## Metas
- Crear: `src/modules/{catalog,bookings,payments,tickets,operations,marketing,identity,demo,audit}`, `src/db`, `src/lib`, `scripts`, `tests/{unit,integration,e2e}`, cada una con un `.gitkeep` (Git no versiona carpetas vacías).
- `.gitignore`: añadir `storage/` y `*.log` (ya existen `node_modules/`, `dist/`, `.astro/`, `.env`, `.env.*`, `!.env.example` desde la issue #2).
- Ningún archivo privado dentro de `public/`.

## No metas
Subcarpetas internas de módulos (`schema`, `domain`, `service`, `repository`), código de negocio, validación de variables de entorno y `.env.example` (issue #4), lint (#5), infraestructura de pruebas (#7).

## Anti-metas
Carpetas vacías sin `.gitkeep` que desaparecen al clonar; `storage/` o `.env` apareciendo en `git status`; READMEs de relleno.

## Restricciones
- Estructura idéntica a la guía; `src/pages` y `src/components` ya existen (issue #2).
- Archivos privados fuera de `public/` y servidos solo por controlador con autorización (`docs/02-diseno/06-security-and-access.md`).
- Sin Python; solo Bun/Node/bash. Commits en Conventional Commits; rama `chore/h0-estructura-carpetas`; PR hacia `dev` con `Closes #3` (ADR-016).

## Enfoques
1. **Carpetas con `.gitkeep`, sin README por módulo, `storage/` solo ignorado (elegido):** mínimo y exactamente lo que pide la issue.
2. **`storage/.gitkeep` versionado con `storage/*` ignorado:** descartado; la issue pide `storage/` ignorado por completo y la aplicación puede crear las carpetas.
3. **README en cada módulo:** descartado; hoy no aportan ("solo si aporta").

## Decisiones tomadas
- `storage/` no se versiona ni se crea en el repo: la aplicación creará `storage/private` y `storage/demo` al arrancar (issues #4 y H1) según `PRIVATE_STORAGE_DIR`/`DEMO_STORAGE_DIR`.
- `public/` no se crea.
- Verificación con archivos temporales (`.env`, `storage/private/x.txt`, `.env.example`) y `git check-ignore -v`; se borran después.
- No hace falta ADR (no cambia ninguna regla confirmada). Se actualizan la guía y `00-estado.md`.
- Context7 no aplica: no hay API de librería; solo estructura de archivos y sintaxis de Git.

## A cargo del constructor
Redacción de las notas en la guía y `00-estado.md`; orden de patrones en `.gitignore`.
