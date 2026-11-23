# Issue #5 — Formato y lint: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** `bun run lint` y `bun run format:check` pasan en un clon limpio, con accesibilidad estática `recommended` en `.astro` y `.tsx`.

**Architecture:** Prettier formatea todo salvo `docs/` y `bun.lock`; ESLint 10 (flat config) lintea `.astro`, `.ts`, `.tsx`, `.mjs`. El "test" de cada herramienta es un archivo temporal que debe fallar (RED) y luego la verificación en clon limpio.

**Tech Stack:** Prettier 3.10.1, prettier-plugin-astro 1.1.2, ESLint 10.15.0, typescript-eslint 8.73.0, eslint-plugin-astro 3.2.1, eslint-plugin-jsx-a11y-x 0.2.0, @eslint/js 10.0.1, globals 17.14.0.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-5-formato-lint-design.md`

## Global Constraints

- Todas las versiones **exactas** (sin `^`/`~`): las 8 de arriba. `@types/*` y TypeScript no cambian (TypeScript 6.0.3; typescript-eslint admite `<6.1.0`).
- No añadir herramientas fuera de la lista (nada de `eslint-config-prettier`, `eslint-plugin-react*`, Biome, husky).
- Prettier: `printWidth: 100`, `endOfLine: "auto"`, plugin astro con `overrides` para `*.astro` (parser `astro`). `.prettierignore`: `docs/`, `bun.lock`.
- ESLint: flat config `eslint.config.mjs`; `js.configs.recommended`, `tseslint.configs.recommended` (sin type-aware), `astro.configs.recommended`, accesibilidad en nivel `recommended` para `.astro` (`astro.configs['jsx-a11y-recommended']`) y para `.tsx`; `globalIgnores` de `dist/`, `.astro/`, `node_modules/`; `linterOptions.reportUnusedDisableDirectives: "error"`.
- **Prohibido desactivar reglas globalmente.** Excepciones solo puntuales con `// eslint-disable-next-line <regla> -- <motivo>`.
- Scripts: `"format": "prettier . --write"`, `"format:check": "prettier . --check"`, `"lint": "eslint . --max-warnings 0"`.
- El reformateo inicial va en un commit propio (`style:`), sin cambios de lógica.
- ADR nuevo = **ADR-018** (015, 016 y 017 ya existen).
- Sin Python; Bun/Node. Commits en Conventional Commits; rama `chore/h0-formato-lint` (ya creada); PR a `dev` con `Closes #5`.

## Review Focus

- **Clon limpio en Windows:** Git convierte a CRLF al hacer checkout; `format:check` debe pasar igualmente (`endOfLine: "auto"`). Probar con un `git clone` real, no con el árbol de trabajo.
- **Accesibilidad:** una `<label>` sin control asociado debe fallar el lint **tanto en `.astro` como en `.tsx`**; un `<img>` sin `alt` también. Documentar que un `<input>` sin nombre accesible no es detectable estáticamente.
- **Cobertura de `.astro`:** un error de TypeScript/ESLint en el frontmatter y una violación en la plantilla deben ser detectados.
- **Directivas huérfanas:** un `eslint-disable` que no suprime nada debe fallar (`reportUnusedDisableDirectives`).
- **Prettier no debe tocar `docs/`** ni `bun.lock`, y debe formatear `.astro`.
- Una advertencia (warning) debe hacer fallar `lint` (`--max-warnings 0`).

---

### Task 1: Prettier y formato inicial

**Files:**
- Create: `.prettierrc.json`, `.prettierignore`
- Modify: `package.json` (devDependencies exactas, scripts `format` y `format:check`), `bun.lock`
- Modify (solo formato, commit aparte): los archivos que Prettier reescriba (`src/`, `tests/`, `scripts/`, `astro.config.mjs`, `tsconfig.json`, `package.json`…)

**Interfaces:**
- Produces: scripts `format` y `format:check` que consume la Task 3 y la CI de la issue #10.

- [ ] **Step 1: Instalar y fijar.** Run: `bun add --exact -d prettier@3.10.1 prettier-plugin-astro@1.1.2`. Verificar: `grep -E '"[\^~]' package.json` sin salida.
- [ ] **Step 2: Configurar.** Crear `.prettierrc.json` con `plugins: ["prettier-plugin-astro"]`, `printWidth: 100`, `endOfLine: "auto"` y `overrides` para `*.astro` con `parser: "astro"` (forma documentada en Context7/Astro editor-setup). Crear `.prettierignore` con `docs/` y `bun.lock`. Añadir los scripts `format` y `format:check`.
- [ ] **Step 3: RED.** Crear un archivo temporal `src/components/Tmp.astro` mal formateado (indentación irregular, comillas simples). Run: `bun run format:check; echo "exit=$?"`. Expected: `exit=1` y el archivo temporal listado entre los que incumplen. Comprobar también que **no** se listan archivos de `docs/`.
- [ ] **Step 4: Formato inicial.** Borrar el temporal. Run: `bun run format` y `git diff --stat`. Expected: solo cambios de formato (revisar el diff completo; ninguna línea de lógica cambia). Run: `bun run format:check; echo "exit=$?"`. Expected: `exit=0`.
- [ ] **Step 5: Comprobar que nada se rompió.** Run: `bun test tests/unit && bun run check`. Expected: 16 pruebas y 0 errores.
- [ ] **Step 6: Commits (dos).**

```bash
git add .prettierrc.json .prettierignore package.json bun.lock
git commit -m "chore: configurar Prettier con plugin de Astro y scripts de formato"
git add -A
git commit -m "style: aplicar formato inicial con Prettier"
```

### Task 2: ESLint con accesibilidad y script `lint`

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (devDependencies exactas y script `lint`), `bun.lock`
- Modify: archivos existentes solo con los arreglos mínimos que exija el lint

**Interfaces:**
- Consumes: formato de la Task 1 (los arreglos se aplican y se vuelven a formatear).
- Produces: script `lint`; `eslint.config.mjs` con la base de accesibilidad.

- [ ] **Step 1: Instalar y fijar.** Run: `bun add --exact -d eslint@10.15.0 typescript-eslint@8.73.0 eslint-plugin-astro@3.2.1 eslint-plugin-jsx-a11y-x@0.2.0 @eslint/js@10.0.1 globals@17.14.0`. Verificar: sin `^`/`~` y sin advertencias de peers.
- [ ] **Step 2: Averiguar la configuración de a11y para `.tsx`.** Leer `node_modules/eslint-plugin-jsx-a11y-x/README.md` y sus exports para identificar el preset `recommended` en flat config; leer también cómo `astro.configs['jsx-a11y-recommended']` lo detecta. Registrar un `Ruling:` con lo hallado (no asumir nombres).
- [ ] **Step 3: RED (accesibilidad).** Sin `eslint.config.mjs` aún, crear temporales `src/components/TmpA11y.tsx` y `src/components/TmpA11y.astro` con `<label>Nombre</label>` sin control asociado y `<img src="x.png">` sin `alt`, más un `// eslint-disable-next-line no-console -- sin uso` huérfano en un `.ts` temporal. Run: `bun run lint; echo "exit=$?"`. Expected: falla porque la config no existe.
- [ ] **Step 4: Implementar `eslint.config.mjs`** con `defineConfig`/`globalIgnores` de `eslint/config`, según Global Constraints: base JS y TS en `**/*.{js,mjs,ts,tsx}`, `astro.configs.recommended`, a11y `recommended` para `.astro` y para `.tsx` (según el `Ruling:` del paso 2), `globals` Node para `*.mjs`, `scripts/` y `tests/`, y `linterOptions.reportUnusedDisableDirectives: "error"`. Añadir el script `lint`.
- [ ] **Step 5: GREEN de las trampas.** Run: `bun run lint; echo "exit=$?"`. Expected: `exit=1` con **cuatro** hallazgos de los temporales: label sin control en `.tsx`, label sin control en `.astro`, `alt` faltante (en al menos uno) y la directiva `eslint-disable` sin uso. Si falta alguno, no continuar: ajustar la config.
- [ ] **Step 6: Borrar los temporales y arreglar lo existente.** Run: `bun run lint`. Corregir cada hallazgo en el código real con el cambio mínimo; **sin desactivar reglas globalmente**. Si una excepción puntual es inevitable, usar `eslint-disable-next-line <regla> -- <motivo>` y anotarla en el ledger.
- [ ] **Step 7: Verificar warnings.** Introducir temporalmente una variable sin usar (`warn` o `error` según preset) y comprobar que `lint` falla con `--max-warnings 0`; revertir.
- [ ] **Step 8: Verificación completa.** Run: `bun run format && bun run format:check && bun run lint && bun test tests/unit && bun run check`. Expected: todo exit 0.
- [ ] **Step 9: Commit.**

```bash
git add eslint.config.mjs package.json bun.lock src scripts tests astro.config.mjs
git commit -m "chore: configurar ESLint con reglas de accesibilidad para Astro y React"
```

### Task 3: Clon limpio, documentación y PR

**Files:**
- Modify: `docs/04-ingenieria/09-development-guide.md` (tabla de versiones; sección "Formato y lint": scripts, reglas, límite de la accesibilidad estática, excepciones puntuales, `endOfLine: "auto"`), `docs/05-decisiones/11-decisions-and-risks.md` (ADR-018, fila en la tabla), `docs/00-estado.md` (H0 y siguiente paso: issue #6), `CLAUDE.md` (línea de Estado: scripts `format`, `format:check`, `lint`)
- Create (temporal): clon en `<scratchpad>/lint-clone/`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Clon limpio.** Commitear primero lo pendiente (las tareas ya commitearon). Run: `git clone --branch chore/h0-formato-lint E:/proyectos/traveler-web-app <scratchpad>/lint-clone`, luego `bun install --frozen-lockfile` dentro. Expected: `bun.lock` intacto.
- [ ] **Step 2: Verificar en el clon.** Run: `bun run lint; echo "exit=$?"` y `bun run format:check; echo "exit=$?"`. Expected: ambos `exit=0`. Si `format:check` falla por CRLF, **no** reformatear en el clon: corregir la causa en la config (`endOfLine`) y repetir el clon.
- [ ] **Step 3: Documentación.** Escribir la sección de la guía y **ADR-018 — Formato, lint y accesibilidad estática** con: decisión (herramientas y versiones exactas, incluidos `@eslint/js` y `globals` justificados), alternativas (Biome, ESLint 9), consecuencias y el aviso de que `typescript-eslint` 8.73.0 admite TypeScript `<6.1.0` y que **subir a TypeScript 6.1+ exige verificar antes la compatibilidad**, y el límite de la accesibilidad estática. Añadir las versiones a la tabla de Requisitos. Actualizar `00-estado.md` y `CLAUDE.md`. No afirmar scripts inexistentes.
- [ ] **Step 4: Verificar docs.** Run: `grep -n "ADR-018" docs/05-decisiones/11-decisions-and-risks.md docs/04-ingenieria/09-development-guide.md`. Expected: aparece en ambos. Run: `bun run format:check && bun run lint`. Expected: exit 0 (`docs/` está ignorado por Prettier).
- [ ] **Step 5: Commit.**

```bash
git add docs CLAUDE.md
git commit -m "docs: ADR-018 de formato, lint y accesibilidad estática y guía actualizada"
```

- [ ] **Step 6: Push y PR (pedir confirmación antes).** `git push -u origin chore/h0-formato-lint` y `gh pr create --base dev` con `Closes #5`, resumen, el límite de a11y estática y lo no probado.

---

## Autorrevisión

- Cubre las 4 tareas de la issue: herramientas compatibles y decisión documentada (T1-T3, ADR-018), scripts `format`/`format:check`/`lint` (T1-T2), accesibilidad JSX (T2 pasos 3-5), documentar en la guía (T3).
- Criterio de aceptación: clon limpio con `lint` y `format:check` en 0 (T3 pasos 1-2).
- Decisiones del responsable reflejadas: nivel `recommended`, scripts, reformateo inicial en commit propio, nota TS `<6.1.0` en ADR, cobertura `.astro`/`.tsx`/`.ts`, sin desactivar reglas globalmente.
- Corrección de numeración: el responsable pidió "ADR-015"; se usa ADR-018 porque 015-017 existen.
- Sin tipos ni funciones compartidas entre tareas; los nombres que se consumen son los scripts `format`, `format:check`, `lint`.
