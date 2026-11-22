# Issue #7 — Infraestructura de pruebas (diseño)

**Aprobado por el responsable en la conversación (2026-11-22), con E2E en la opción 1 (pendiente).** Tamaño: cambio pequeño (scripts + documentación); casi toda la infraestructura ya existe.

## Intención
Dejar oficial y reproducible la forma de ejecutar las pruebas y documentar lo que queda para H1, sin construir infraestructura que aún no tiene nada que probar. Criterio de aceptación: `bun run test` pasa desde un clon limpio, sin `.env`, PostgreSQL ni servicios externos; base para la CI de la issue #10.

## Metas
- Scripts `test:unit` (`bun test tests/unit`), `test:integration` (`bun test tests/integration`) y `test` (ambos, en ese orden).
- ADR-020: `bun test` como runner oficial, con alternativas y razones.
- Documentar, como **propuesta pendiente de confirmar en H1** (PEN-15), cómo se ejecutará la integración con PostgreSQL.
- Ampliar PEN-13 para registrar la herramienta E2E: Playwright + `@axe-core/playwright` como candidatos recomendados, sin instalarlos.

## No metas
`bunfig.toml`, umbrales de cobertura, infraestructura PostgreSQL (Docker, `TEST_DATABASE_URL` real, migraciones de prueba), instalar Playwright o descargar navegadores, pruebas E2E artificiales, corregir los menores diferidos de la prueba de integración (carrera del puerto libre, `sleep`).

## Anti-metas
Una prueba que dependa de `.env`, de una base de datos o de un servicio externo; presentar como implementado lo que es solo propuesta; que una variable de entorno sola autorice operaciones destructivas sobre una base de datos.

## Hechos verificados
- `bun test` descubre hoy 49 pruebas (40 unitarias en ~0,1 s y 9 de integración en ~4 s) sin configuración.
- Por defecto `bun test` ejecuta los archivos **en serie**; `--parallel` (archivos en procesos) y `--concurrent` (pruebas dentro de un archivo) son opt-in; `--isolate` aísla el estado global entre archivos (Context7, docs de Bun).
- Astro documenta Vitest con `getViteConfig()` para pruebas unitarias y de integración, y su Container API para componentes. Las pruebas con `bun test` no pueden importar módulos virtuales `astro:*` (por eso existe el fixture de `tests/fixtures/api-errors/`).
- Playwright 1.65.1 ejecuta su runner bajo Bun con `bunx --bun playwright test`; `@axe-core/playwright` 4.14.0.

## Decisiones tomadas
- **Runner:** `bun test` (integrado, TypeScript nativo, API compatible con Jest, ya usado por 49 pruebas). Alternativas descartadas: Vitest (el que documenta Astro; añade dependencias y configuración, y hoy no hay código que lo exija), Jest (más pesado y requiere transformación de TypeScript), `node:test` (menos herramientas de mocks y de ecosistema). Consecuencia: acopla las pruebas al runtime Bun (coherente con ADR-002); si en el futuro hace falta probar código que importe `astro:*` sin fixture, reconsiderar Vitest + `getViteConfig()` (no se probó).
- **Scripts:** `test` = `bun run test:unit && bun run test:integration`. Rutas explícitas (no `bun test` a secas), para no recoger archivos que no sean de estas categorías.
- **PostgreSQL en H1 (propuesta, PEN-15):** base `traveltech_test` independiente de la privada y la demo; variable `TEST_DATABASE_URL` exclusiva de pruebas; migraciones (`drizzle-kit migrate`) sobre esa base; pruebas PostgreSQL omitidas (`describe.skipIf`) si no hay configuración de pruebas habilitada; conexiones reales y separadas para los casos de concurrencia (INV-01, BRD-01). **Condición obligatoria:** no basta con que exista `TEST_DATABASE_URL`; en H1 debe implementarse una validación explícita que impida ejecutar limpieza o migraciones de prueba sobre las bases privada o demo (p. ej. comparar contra `DATABASE_URL` y `DEMO_DATABASE_URL` y exigir un nombre de base de pruebas reconocible, antes de cualquier operación destructiva). **Aislamiento:** transacciones con reversión cuando sea viable; limpieza o recreación controlada (no limpiar tablas compartidas entre archivos que puedan ejecutarse en paralelo: provoca resultados intermitentes) para las pruebas de concurrencia, que necesitan confirmar transacciones reales. Nada de esto está implementado.
- **E2E (PEN-13 ampliado):** Playwright + `@axe-core/playwright` como candidatos recomendados; la decisión definitiva se toma cuando exista la primera interfaz real (H1). No se instalan ni se descargan navegadores; `tests/e2e/` conserva su `.gitkeep`.
- ADR nuevo: **ADR-020**. Pendientes: **PEN-15** (nuevo) y **PEN-13** (ampliado).

## Enfoques
1. **Solo scripts + documentación (elegido):** lo que la issue necesita; no se construye nada sin uso.
2. **Añadir `bunfig.toml`, cobertura y esqueleto de PostgreSQL/E2E ahora:** descartado por el responsable (fuera de alcance, sin nada que probar todavía).

## A cargo del constructor
Redacción de ADR-020 y de la sección de `10-testing-and-quality.md`; qué filas de `09-development-guide.md` y de `CLAUDE.md` actualizar.
