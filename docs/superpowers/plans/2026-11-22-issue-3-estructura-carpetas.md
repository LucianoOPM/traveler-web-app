# Issue #3 — Estructura de carpetas, .gitignore y storage privado: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** Crear el esqueleto de carpetas de la guía de desarrollo y blindar el `.gitignore` para que secretos y storage nunca entren al repositorio.

**Architecture:** Cada carpeta nueva lleva un `.gitkeep`. `storage/` solo se ignora. La "prueba" es una verificación con archivos temporales y `git check-ignore`, más una comparación de `git ls-files` con la estructura de la guía.

**Tech Stack:** Git, bash. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-3-estructura-carpetas-design.md`

## Global Constraints

- Estructura idéntica a `docs/04-ingenieria/09-development-guide.md` (sección Estructura): `src/modules/{catalog,bookings,payments,tickets,operations,marketing,identity,demo,audit}`, `src/db`, `src/lib`, `scripts`, `tests/{unit,integration,e2e}`; `src/pages` y `src/components` ya existen.
- Cada carpeta nueva con `.gitkeep`; sin subcarpetas internas de módulos, sin README por módulo.
- `storage/` solo en `.gitignore` (no se crea ni se versiona); `public/` no se crea.
- `.gitignore` conserva `node_modules/`, `dist/`, `.astro/`, `.env`, `.env.*`, `!.env.example` y añade `storage/` y `*.log`.
- Sin Python; Bun/Node/bash. Commits en Conventional Commits; rama `chore/h0-estructura-carpetas` (ya creada desde `dev`); PR a `dev` con `Closes #3`.
- Fuera de alcance: `.env.example` y validación de entorno (#4), lint (#5), pruebas (#7).

## Review Focus

- Un clon limpio debe contener todas las carpetas: sin `.gitkeep` desaparecen. Probar con `git ls-files` (no con `ls`).
- `.env.example` no debe quedar ignorado por `.env.*`: la excepción `!.env.example` tiene que ir después del patrón.
- `storage/` debe ignorarse a cualquier profundidad (`storage/private/x.txt` y también `storage/demo/y/z.bin`).
- Un archivo dentro de `public/` no debe quedar ignorado por error de patrón (Astro sirve `public/`): comprobar que `public/favicon.svg` NO se ignora.
- `git status` tras crear los archivos temporales no debe mostrar `.env` ni `storage/`.

---

### Task 1: Esqueleto de carpetas y `.gitignore`

**Files:**
- Create: `.gitkeep` en cada una de: `src/modules/catalog`, `src/modules/bookings`, `src/modules/payments`, `src/modules/tickets`, `src/modules/operations`, `src/modules/marketing`, `src/modules/identity`, `src/modules/demo`, `src/modules/audit`, `src/db`, `src/lib`, `scripts`, `tests/unit`, `tests/integration`, `tests/e2e`
- Modify: `.gitignore`

**Interfaces:**
- Produces: las 15 carpetas versionadas y el `.gitignore` final que consume la Task 2.

- [ ] **Step 1: Escribir la comprobación que debe fallar (RED).** Run: `git check-ignore -q storage/private/x.txt; echo "exit=$?"`. Expected: `exit=1` (aún no se ignora `storage/`) y `git ls-files src/modules | wc -l` da `0`.
- [ ] **Step 2: Crear las 15 carpetas con su `.gitkeep`** (un `mkdir -p` más `touch` por carpeta, en bash).
- [ ] **Step 3: Ampliar `.gitignore`** añadiendo `storage/` y `*.log` sin tocar las líneas existentes; la excepción `!.env.example` queda después de `.env.*`.
- [ ] **Step 4: Verificar GREEN.** Run: `git add -A && git ls-files | grep .gitkeep | wc -l`. Expected: `15`. Run: `git check-ignore -v storage/private/x.txt`. Expected: una línea que cita la regla `storage/`.
- [ ] **Step 5: Commit.**

```bash
git commit -m "chore: crear estructura de carpetas y ampliar .gitignore"
```

### Task 2: Verificación de secretos y storage

**Interfaces:**
- Consumes: carpetas y `.gitignore` de la Task 1.

- [ ] **Step 1: Crear archivos temporales:** `.env`, `.env.local`, `.env.example`, `storage/private/x.txt`, `storage/demo/y/z.bin`, `public/favicon.svg`, `debug.log`.
- [ ] **Step 2: Comprobar con `git check-ignore -v` cada uno.** Expected: se ignoran `.env`, `.env.local`, `storage/private/x.txt`, `storage/demo/y/z.bin` y `debug.log`; **no** se ignoran `.env.example` ni `public/favicon.svg` (`git check-ignore` sale con 1 para ellos).
- [ ] **Step 3: Run `git status --short`.** Expected: aparecen solo `.env.example` y `public/` como no rastreados; no aparecen `.env`, `.env.local`, `storage/` ni `debug.log`.
- [ ] **Step 4: Borrar todos los temporales** (`.env`, `.env.local`, `.env.example`, `storage/`, `public/`, `debug.log`). Run: `git status --short`. Expected: limpio (sin cambios sin commitear en el árbol, salvo docs del paso siguiente).
- [ ] **Step 5: Comparar con la guía.** Run: `git ls-files | grep -E '\.gitkeep$' | sed 's#/\.gitkeep##' | sort` y contrastar a mano con la sección Estructura. Expected: las 15 rutas de Global Constraints, ni una más ni una menos.

### Task 3: Documentación y PR

**Files:**
- Modify: `docs/04-ingenieria/09-development-guide.md` (sección Estructura: nota de que las carpetas existen con `.gitkeep`, que `storage/` se crea en tiempo de ejecución y está ignorado, y que `public/` no se usa para archivos privados)
- Modify: `docs/00-estado.md` (H0: mencionar estructura creada; "Siguiente paso sugerido": issue #4)

**Interfaces:**
- Consumes: resultados de la Task 2.

- [ ] **Step 1: Editar ambos archivos** con la herramienta Edit, sin repetir cifras del seed ni afirmar scripts inexistentes.
- [ ] **Step 2: Verificar.** Run: `grep -n "storage" docs/04-ingenieria/09-development-guide.md docs/00-estado.md`. Expected: la nota aparece en la guía y el estado no contradice la guía.
- [ ] **Step 3: Commit.**

```bash
git add docs
git commit -m "docs: documentar estructura de carpetas y storage ignorado"
```

- [ ] **Step 4: Push y PR (pedir confirmación antes).** `git push -u origin chore/h0-estructura-carpetas` y `gh pr create --base dev` con `Closes #3`, resumen y lo no probado.

---

## Autorrevisión

- Cubre las 4 tareas de la issue: estructura de la guía (T1), `.gitignore` (T1), `storage/` ignorado y `public/` sin privados (T1-T2), README solo si aporta (decidido: ninguno, spec).
- La verificación incluye los casos que muerden: excepción de `.env.example`, profundidad de `storage/` y que `public/` no quede ignorada.
- Sin tipos ni funciones: no hay nombres que reconciliar entre tareas.
