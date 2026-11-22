# Issue #7 — Infraestructura de pruebas: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** `bun run test`, `bun run test:unit` y `bun run test:integration` funcionan desde un clon limpio sin `.env`, PostgreSQL ni servicios externos, y quedan documentados el runner, la propuesta de PostgreSQL para H1 y la decisión pendiente de E2E.

**Architecture:** Solo tres scripts en `package.json` sobre `bun test` y documentación. La "prueba" es un clon limpio sin `.env` con entorno saneado.

**Tech Stack:** Bun 1.4.4 (`bun test`). Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-7-infraestructura-pruebas-design.md`

## Global Constraints

- Sin dependencias nuevas, sin `bunfig.toml`, sin umbrales de cobertura, sin instalar Playwright ni descargar navegadores, sin pruebas E2E artificiales, sin infraestructura PostgreSQL.
- Scripts: `"test:unit": "bun test tests/unit"`, `"test:integration": "bun test tests/integration"`, `"test": "bun run test:unit && bun run test:integration"`.
- Ninguna prueba puede requerir `.env`, PostgreSQL ni servicios externos.
- Lo de PostgreSQL y E2E se documenta como **propuesta pendiente** (PEN-15, PEN-13), nunca como implementado. La validación que impide operaciones destructivas sobre las bases privada o demo es **requisito obligatorio de H1**, no depende solo de que exista `TEST_DATABASE_URL`.
- ADR nuevo = **ADR-020**; PEN nuevo = **PEN-15**.
- Sin Python; Bun/Node. Commits en Conventional Commits; rama `chore/h0-infraestructura-pruebas` (ya creada desde `dev`); PR a `dev` con `Closes #7`. Antes de cada commit: `bun run format`, `bun run lint`, `bun run check`.

## Review Focus

- Un clon limpio **sin `.env`** y con entorno saneado (sin las variables `DATABASE_URL`, `AUTH_SECRET`, etc. ni `NODE_ENV`) debe pasar `bun run test`.
- `test:unit` no debe ejecutar la prueba de integración ni al revés (conteos 40 y 9).
- Un fallo en `test:unit` debe cortar `test` con código distinto de 0 (`&&`).
- Nada en los docs debe afirmar que existe `traveltech_test`, `TEST_DATABASE_URL`, Playwright o scripts de BD/E2E.
- Los docs deben dejar explícito que `bun test` ejecuta los archivos en serie por defecto y que `--parallel`/`--concurrent` cambian lo que PEN-15 debe prever.

---

### Task 1: Scripts de prueba

**Files:**
- Modify: `package.json` (tres scripts)

**Interfaces:**
- Produces: `test`, `test:unit`, `test:integration` (consumidos por la CI de la issue #10 y por la guía).

- [ ] **Step 1: RED.** Run: `bun run test; echo "exit=$?"`. Expected: error "Script not found" y `exit=1` (el script `test` no existe).
- [ ] **Step 2: Implementar.** Añadir los tres scripts de Global Constraints con Edit.
- [ ] **Step 3: GREEN por categoría.** Run: `bun run test:unit`, `bun run test:integration` y `bun run test`. Expected: 40 pruebas (3 archivos), 9 pruebas (1 archivo) y ambas en secuencia (49 en total), todas con exit 0.
- [ ] **Step 4: Verificar el corte por fallo.** Crear temporalmente `tests/unit/tmp-falla.test.ts` con una prueba que falle; Run: `bun run test; echo "exit=$?"`. Expected: `exit` distinto de 0 y **no** se ejecuta la integración (no aparece "Ran 9 tests"). Borrar el temporal.
- [ ] **Step 5: Verificación de calidad.** Run: `bun run format:check && bun run lint && bun run check`. Expected: exit 0.
- [ ] **Step 6: Commit.**

```bash
git add package.json
git commit -m "chore: añadir scripts test, test:unit y test:integration"
```

### Task 2: Clon limpio sin entorno

**Files:**
- Create (temporal): clon en `<scratchpad>/test-clone/`

**Interfaces:**
- Consumes: scripts de la Task 1 ya commiteados.

- [ ] **Step 1: Clonar y preparar.** Run: `git clone --branch chore/h0-infraestructura-pruebas E:/proyectos/traveler-web-app <scratchpad>/test-clone` y `bun install --frozen-lockfile` dentro. Expected: `bun.lock` intacto; no existe `.env` (`ls -a`).
- [ ] **Step 2: Ejecutar con el entorno saneado.** Run: `env -u DATABASE_URL -u DEMO_DATABASE_URL -u AUTH_SECRET -u APP_ORIGIN -u PRIVATE_STORAGE_DIR -u DEMO_STORAGE_DIR -u AGENCY_TIMEZONE -u NODE_ENV bun run test; echo "exit=$?"`. Expected: 49 pruebas, `exit=0`.
- [ ] **Step 3: Cada script por separado** en el clon (`test:unit` 40, `test:integration` 9), más `bun run lint` y `bun run format:check`. Expected: exit 0 en todos.
- [ ] **Step 4: Sin servicios.** Comprobar que no hay PostgreSQL accesible durante la ejecución (`docker ps` sin contenedores de la app o servicio apagado) y que las pruebas pasan igualmente. Anotar el resultado.

### Task 3: Documentación

**Files:**
- Modify: `docs/04-ingenieria/10-testing-and-quality.md` (nueva sección "Cómo se ejecutan las pruebas" con scripts, qué hay hoy, **propuesta PostgreSQL H1 (PEN-15)** y **E2E pendiente (PEN-13)**), `docs/04-ingenieria/09-development-guide.md` (tabla de scripts: sustituir las filas `bun test tests/...` por `bun run test`, `test:unit`, `test:integration`; "Antes de cada commit"), `docs/05-decisiones/11-decisions-and-risks.md` (ADR-020 + fila), `docs/05-decisiones/pendientes.md` (PEN-15 nuevo, PEN-13 ampliado), `docs/00-estado.md` (H0; siguiente: issue #8), `CLAUDE.md` (línea de Estado: scripts de prueba)

**Interfaces:**
- Consumes: resultados de las Tasks 1 y 2.

- [ ] **Step 1: ADR-020** con: decisión (`bun test`), hechos verificados (serie por defecto, 49 pruebas), alternativas descartadas con su razón (Vitest, Jest, `node:test`), consecuencias (acoplamiento a Bun, módulos `astro:*` no importables sin fixture, reconsiderar Vitest + `getViteConfig()` si hiciera falta), y qué NO se hizo (cobertura, `bunfig.toml`).
- [ ] **Step 2: Sección de `10-testing-and-quality.md`** con la propuesta de PostgreSQL (base `traveltech_test`, `TEST_DATABASE_URL` exclusiva, migraciones sobre ella, `describe.skipIf`, conexiones separadas para concurrencia, **validación explícita obligatoria contra las bases privada y demo antes de cualquier operación destructiva**, aislamiento por transacciones cuando sea viable y limpieza o recreación controlada para concurrencia, sin limpiar tablas compartidas entre archivos paralelos, nota sobre `--parallel`/`--concurrent`) marcada como **propuesta pendiente de confirmar en H1**; y el estado de E2E (pendiente, sin instalar).
- [ ] **Step 3: PEN-15 y PEN-13** en `pendientes.md`; PEN-13 menciona Playwright + `@axe-core/playwright` (1.65.1 y 4.14.0, soporte de Bun con `bunx --bun`) como candidatos recomendados, sin instalar, decisión en H1.
- [ ] **Step 4: Resto** (guía, estado, `CLAUDE.md`) con Edit.
- [ ] **Step 5: Verificar.** Run: `grep -rn "traveltech_test\|TEST_DATABASE_URL" docs --include=*.md | grep -v superpowers` y revisar que cada mención está marcada como propuesta; `grep -c "PEN-15" docs/05-decisiones/pendientes.md`. Run: `bun run format:check && bun run lint && bun run check && bun run test`. Expected: exit 0.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "docs: ADR-020 de runner de pruebas, PEN-15 de PostgreSQL y PEN-13 ampliado"
```

- [ ] **Step 7: Revisión independiente, correcciones y PR (pedir confirmación antes del push).** `git push -u origin chore/h0-infraestructura-pruebas` y `gh pr create --base dev` con `Closes #7`.

---

## Autorrevisión

- Cubre las 4 tareas de la issue: runner (T1 + ADR-020), carpetas y prueba de ejemplo (ya existen; se verifican en T1/T2), documentar PostgreSQL y E2E (T3), scripts `test` y `test:unit` (T1, más `test:integration`).
- Cada criterio de aceptación tiene su comprobación: clon limpio (T2), scripts (T1), pruebas actuales (T1), sin `.env`/PostgreSQL/servicios (T2 pasos 2 y 4), ADR y PENs (T3), lint y formato (T1 y T3).
- Sin tipos ni funciones: lo único que se consume entre tareas son los nombres de los scripts.
