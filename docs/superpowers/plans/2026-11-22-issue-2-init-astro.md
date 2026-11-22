# Issue #2 — Inicializar Astro + React islands con Bun: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** Dejar un proyecto Astro 7 en modo servidor con islands React, TypeScript estricto comprobado y versiones exactas, que arranque con `bun install && bun run dev` desde un clon limpio.

**Architecture:** Scaffold manual (sin plantilla) con `bun add --exact`. Una página `index.astro` hidrata una island React mínima. `astro check` hace de "test" del TypeScript estricto; `curl` contra `dev`, `build` y `preview` hace de prueba de humo.

**Tech Stack:** Bun 1.4.4, Astro 7.4.13, @astrojs/node 11.1.14, @astrojs/react 7.1.9, React/react-dom 19.3.1, typescript 6.0.3, @astrojs/check 0.9.12.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-2-init-astro-design.md` (y ADR-015 en `docs/05-decisiones/11-decisions-and-risks.md`).

## Global Constraints

- Versiones **exactas** (sin `^`/`~`): Astro 7.4.13, @astrojs/node 11.1.14, @astrojs/react 7.1.9, react y react-dom 19.3.1, typescript 6.0.3 (no 7.x: `@astrojs/check` exige `^5 || ^6`), @astrojs/check 0.9.12.
- Node >= 22.23.4; Bun 1.4.4. Sin Python (solo Bun/Node/bash).
- `output: 'server'`, adaptador `node({ mode: 'standalone' })`; React sin `compiler` (no instalar `oxc-transform-react`).
- tsconfig: `extends: astro/tsconfigs/strict`, `include: [".astro/types.d.ts", "**/*"]`, `exclude: ["dist"]`, `jsx: react-jsx`, `jsxImportSource: react`.
- Fuera de alcance: Drizzle, PostgreSQL/Docker, Better Auth, estructura de carpetas (#3), lint (#5), pruebas (#7).
- Commits en Conventional Commits; rama `chore/h0-init-astro` (ya creada desde `dev`); PR hacia `dev` con `Closes #2`.
- No afirmar que existen `db:migrate`, `admin:create`, `demo:seed`.

## Review Focus

- `bun install` desde un clon limpio (sin `node_modules`) con el lockfile commiteado: debe instalar exactamente lo fijado y no modificar `bun.lock` (`bun install --frozen-lockfile` pasa).
- `astro dev` no se probó en la validación de PEN-11 (un intento dio 000): debe responder 200 en `http://localhost:4321/` y la island debe hidratar.
- `bun run dev` usa Node por el shebang; con `bun --bun run dev` puede comportarse distinto: documentar el resultado real, no suponerlo.
- `astro preview` con el adaptador Node no está confirmado por la documentación: comprobar que sirve el build o documentar la alternativa (`bun ./dist/server/entry.mjs`).
- Un error de tipos debe hacer fallar `bun run check` (si no, `strict` no se está comprobando).

---

### Task 1: Scaffold del proyecto y comprobación de tipos

**Files:**
- Create: `package.json`, `bun.lock` (generado), `astro.config.mjs`, `tsconfig.json`, `src/pages/index.astro`, `src/components/Counter.tsx`
- Modify: `.gitignore` (crear si no existe; solo `node_modules/`, `dist/`, `.astro/`; no pisar contenido existente)

**Interfaces:**
- Produces: scripts `dev`, `build`, `preview`, `check` en `package.json`; componente `export default function Counter(): JSX.Element` en `src/components/Counter.tsx` (botón con contador, estado local), consumido por `src/pages/index.astro` con `client:load`.

- [ ] **Step 1: Inicializar y fijar dependencias.** Crear `package.json` con `name: "traveltech"`, `private: true`, `type: "module"`, `packageManager: "bun@1.4.4"`, `engines: { node: ">=22.23.4" }` y los scripts `"dev": "astro dev"`, `"build": "astro build"`, `"preview": "astro preview"`, `"check": "astro check"`. Luego `bun add --exact astro@7.4.13 @astrojs/react@7.1.9 @astrojs/node@11.1.14 react@19.3.1 react-dom@19.3.1` y `bun add --exact -d typescript@6.0.3 @astrojs/check@0.9.12 @types/react @types/react-dom` (anotar las versiones resueltas de los `@types`, también exactas).
- [ ] **Step 2: Verificar que no hay rangos.** Run: `grep -E '"[\^~]' package.json`. Expected: sin salida.
- [ ] **Step 3: Escribir el test que debe fallar (RED).** Crear `tsconfig.json` según Global Constraints y `src/components/Counter.tsx` con el componente **más** la línea `const roto: number = "texto";`. Run: `bun run check`. Expected: FAIL con un error de tipo en `Counter.tsx` (prueba de que `strict` se comprueba).
- [ ] **Step 4: Implementar.** Quitar la línea `roto`. Crear `astro.config.mjs` (`defineConfig` con `output: 'server'`, `adapter: node({ mode: 'standalone' })`, `integrations: [react()]`) y `src/pages/index.astro` (título `TravelTech` y `<Counter client:load />`).
- [ ] **Step 5: Verificar.** Run: `bun run check && bun run build`. Expected: `astro check` con 0 errores/0 warnings y build `Complete!` sin errores.
- [ ] **Step 6: Commit.**

```bash
git add package.json bun.lock astro.config.mjs tsconfig.json src .gitignore
git commit -m "chore: inicializar proyecto Astro 7 con islands React y TypeScript estricto"
```

### Task 2: Prueba de humo desde un clon limpio (dev, preview, runtimes)

**Files:**
- Create: `<scratchpad>/init-clone/` (clon desechable fuera del repo, no se commitea)

**Interfaces:**
- Consumes: scripts y archivos de la Task 1, ya commiteados.
- Produces: resultados reales (dev con Node, dev con `bun --bun`, preview) que usa la Task 3 para documentar.

- [ ] **Step 1: Clon limpio.** Run: `git clone --branch chore/h0-init-astro E:/proyectos/traveler-web-app <scratchpad>/init-clone` (clon local de la rama con lo commiteado) y `bun install --frozen-lockfile` dentro. Expected: instala sin modificar `bun.lock` y sin errores.
- [ ] **Step 2: `bun run dev`.** Arrancar en segundo plano, esperar a que escuche y ejecutar `curl -s -o body.html -w '%{http_code}' http://localhost:4321/`. Expected: `200` y `grep -c astro-island body.html` ≥ 1. Detener el proceso.
- [ ] **Step 3: `bun --bun run dev`.** Repetir el paso 2. Anotar si responde 200 o falla (y el error exacto); no es criterio de aceptación.
- [ ] **Step 4: `bun run build && bun run preview`.** `curl` a la URL que imprima `preview`. Expected: 200 con la island. Si `preview` no sirve con el adaptador Node, anotar el mensaje y probar `bun ./dist/server/entry.mjs`.
- [ ] **Step 5: Comprobar que no ensució el repo.** Run: `git status --short` en el repo principal. Expected: limpio. Ningún commit en esta tarea.

### Task 3: Documentación y PR

**Files:**
- Modify: `docs/04-ingenieria/09-development-guide.md` (tabla Requisitos: filas `typescript` 6.0.3 y `@astrojs/check` 0.9.12 con la nota del límite `^5 || ^6`; sección "Inicio recomendado": scripts reales `dev`, `build`, `preview`, `check` y resultado de `bun run dev` vs `bun --bun run dev` y de `preview`)
- Modify: `docs/05-decisiones/11-decisions-and-risks.md` (ADR-015: línea de actualización con fecha 2026-11-22 que añade typescript 6.0.3 y @astrojs/check 0.9.12 y el motivo de no usar 7.x)
- Modify: `docs/00-estado.md` (H0: "En curso"; quitar "No hay código" si ya no aplica; fecha)

**Interfaces:**
- Consumes: resultados de la Task 2.

- [ ] **Step 1: Editar los tres archivos** con la herramienta Edit, copiando versiones exactas y resultados reales de la Task 2 (nada supuesto).
- [ ] **Step 2: Verificar coherencia.** Run: `grep -rn "typescript\|@astrojs/check" docs/04-ingenieria docs/05-decisiones`. Expected: las mismas versiones (6.0.3 / 0.9.12) en la guía y el ADR.
- [ ] **Step 3: Commit.**

```bash
git add docs
git commit -m "docs: documentar scripts, typescript 6.0.3 y @astrojs/check en ADR-015 y guía"
```

- [ ] **Step 4: Push y PR (pedir confirmación antes).** `git push -u origin chore/h0-init-astro` y `gh pr create --base dev --title "chore: inicializar proyecto Astro + React islands con Bun" --body "Closes #2 ..."` con resumen y lo no probado.

---

## Autorrevisión

- Cubre las 5 tareas de la issue: scaffold con React (T1), tsconfig estricto (T1), versiones exactas y `bun.lock` (T1, pasos 1-2 y T2 paso 1), página y `dev` en 4321 (T1 y T2), scripts base (T1).
- El "test" de TypeScript es RED real (Task 1, paso 3) y la prueba de humo cubre el criterio de aceptación desde un clon limpio.
- Nombres consistentes: `Counter` (default export) en `src/components/Counter.tsx`, usado en `index.astro`; scripts `dev|build|preview|check`.
- Desviación respecto de la issue: se añade el script `check` y dos devDependencies, aprobadas por el responsable.
