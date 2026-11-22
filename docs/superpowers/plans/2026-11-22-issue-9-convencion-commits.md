# Issue #9 — Convención de commits con verificación: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** Tras `bun install` en un clon Git, el hook `commit-msg` queda instalado y rechaza localmente los commits cuya cabecera no cumpla Conventional Commits, aceptando las excepciones acordadas.

**Architecture:** `scripts/commit-msg.ts` (validador puro + CLI) invocado por `.githooks/commit-msg` (sh mínimo); `scripts/instalar-hooks.ts` (vía `prepare`) configura `core.hooksPath`. Se prueban el validador (unitarias) y todo el flujo con un repositorio Git temporal real (integración).

**Tech Stack:** Bun 1.4.4 (`bun test`, `Bun.spawn`), Git, sh. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-9-convencion-commits-design.md`

## Global Constraints

- Sin `commitlint`, Husky, Lefthook ni otra dependencia. Solo se valida la cabecera (primera línea que no esté vacía ni empiece por `#`).
- Tipos: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`, `build`, `ci`, `revert`. Formato `type(scope)!: descripción`; scope y `!` opcionales; scope en minúsculas; descripción no vacía; cabecera ≤ **100** caracteres.
- Excepciones (se aceptan tal cual): cabecera que empieza por `Merge `, `Revert "`, `fixup! `, `squash! `, `amend! `.
- Bun ausente → el hook sale con error claro (bloquea el commit). `--no-verify` sigue permitido.
- Sin repositorio Git, `prepare` termina con código 0 sin tocar nada; si ya existe un `core.hooksPath` local distinto de `.githooks`, `prepare` avisa y no lo pisa.
- `.githooks/commit-msg` debe quedar con modo ejecutable en el índice de Git (`100755`) y con saltos de línea LF.
- Sin Python; Bun/Node/sh. Commits en Conventional Commits; rama `chore/h0-convencion-commits` (ya creada desde `dev`); PR a `dev` con `Closes #9`. Antes de cada commit: `bun run format`, `bun run lint`, `bun run check`.
- Fuera de alcance: validación en servidor y de títulos de PR (#10).

## Review Focus

- `Merge branch 'x' into dev` creado por `git merge --no-ff` local no debe ser bloqueado; `git revert` (mensaje `Revert "..."`) y `git commit --fixup` tampoco.
- Una cabecera de exactamente 100 caracteres se acepta y de 101 se rechaza; la longitud cuenta caracteres, no bytes (acentos y `ñ`).
- Mensajes con CRLF, con líneas de comentario `#` al principio, o con cuerpo largo sin formato, no deben dar falsos negativos ni positivos.
- `Feat: x`, `feat:x`, `feat(): x`, `feat(H0): x`, `feat (h0): x`, `feat: ` (descripción vacía), `feature: x`, `Revert x` (sin comillas) y `Mergex` deben rechazarse.
- El hook debe funcionar en Windows (Git for Windows) y en POSIX: LF, modo `100755`, ruta relativa a su propio directorio.
- `bun install` desde un clon recién clonado instala el hook sin pasos manuales; fuera de un repo Git no falla; un `core.hooksPath` ajeno no se pisa.
- El mensaje de error debe ser comprensible (tipos válidos, ejemplo, cómo saltarlo con `--no-verify` solo si se hace a propósito).

---

### Task 1: Validador de mensajes (TDD)

**Files:**
- Create: `scripts/commit-msg.ts`, `tests/unit/commit-msg.test.ts` (y quitar `scripts/.gitkeep` si existiera; `scripts/start.ts` ya existe)

**Interfaces:**
- Produces (consumido por Tasks 2 y 3 y por la CI de la issue #10):
  - `const TIPOS_COMMIT: readonly string[]` (los 11 tipos)
  - `const MAX_LONGITUD_CABECERA = 100`
  - `function validarMensaje(mensaje: string): string | null` (`null` = válido; `string` = error en español)
  - Al ejecutarse como programa (`import.meta.main`): `bun scripts/commit-msg.ts <archivo>` lee el archivo, valida, imprime el error en `stderr` y sale con 1 si es inválido; sale con 0 si es válido.

- [ ] **Step 1: Tests (RED)** en `tests/unit/commit-msg.test.ts` con `bun:test` y estos nombres exactos:
  - `acepta los 11 tipos con y sin scope` (cada tipo con `: descripción` y con `(h0): descripción`).
  - `acepta ! con y sin scope` (`feat!: x`, `feat(payments)!: x`).
  - `acepta scopes en minúsculas sin lista cerrada` (`h0`, `payments`, `demo`, `db`, `api-v1`).
  - `acepta descripciones en español y en inglés`.
  - `acepta las excepciones acordadas` (`Merge pull request #20 from a/b`, `Merge branch 'x' into dev`, `Revert "feat: x"`, `fixup! feat: x`, `squash! x`, `amend! x`).
  - `solo valida la cabecera` (cuerpo y pie libres, sin formato, no afectan).
  - `ignora líneas de comentario y saltos CRLF` (`# comentario\nfeat: x`, `feat: x\r\n`).
  - `rechaza mensajes vacíos o solo con comentarios`.
  - `rechaza cabeceras mal formadas` (`añadir cosas`, `Feat: x`, `FEAT: x`, `feat:x`, `feat: `, `feat:   `, `feature: x`, `feat(): x`, `feat(H0): x`, `feat (h0): x`, `feat(h0) : x`, `merge: x`, `Mergex y`, `Revert x`).
  - `limita la cabecera a 100 caracteres, contados como caracteres` (100 válida, 101 inválida; también una de 100 con `ñ` y acentos válida).
  - `el error es comprensible` (el texto menciona Conventional Commits, lista los 11 tipos y contiene un ejemplo con el formato).
- [ ] **Step 2: Run** `bun run test:unit`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** `scripts/commit-msg.ts` con las firmas de Interfaces: cabecera = primera línea no vacía que no empiece por `#`, sin `\r`; excepciones; expresión regular del formato acordado; longitud por caracteres; y el bloque `import.meta.main` que lee el archivo de `Bun.argv[2]`.
- [ ] **Step 4: Run** `bun run test:unit && bun run lint && bun run format:check && bun run check`. Expected: exit 0 (anotar el nuevo total de pruebas unitarias).
- [ ] **Step 5: Commit.**

```bash
git add scripts/commit-msg.ts tests/unit/commit-msg.test.ts
git commit -m "feat: añadir validador de mensajes de commit (Conventional Commits)"
```

### Task 2: Hook, instalación automática y prueba de integración con Git real (TDD)

**Files:**
- Create: `.githooks/commit-msg`, `scripts/instalar-hooks.ts`, `tests/integration/commit-hook.test.ts`
- Modify: `package.json` (script `prepare`)

**Interfaces:**
- Consumes: `scripts/commit-msg.ts` (Task 1).
- Produces: hook `.githooks/commit-msg`; script `scripts/instalar-hooks.ts` (sin exportaciones; se ejecuta como programa y sale con 0 salvo error inesperado); script `prepare`.

- [ ] **Step 1: Tests de integración (RED)** en `tests/integration/commit-hook.test.ts`. Cada caso crea un repositorio temporal (`git init`, `user.name`/`user.email` locales, `core.hooksPath` apuntando a `<repo real>/.githooks`) y se borra al terminar. Nombres exactos:
  - `rechaza un commit con mensaje no convencional` (`git commit --allow-empty -m "mensaje malo"` sale con código ≠ 0, `stderr` menciona Conventional Commits y no se crea el commit).
  - `acepta un commit con mensaje convencional` (`feat(h0): mensaje válido` sale con 0 y el commit existe).
  - `acepta las excepciones de Git` (`Revert "feat: x"`, `fixup! feat: x`, y un `git merge --no-ff` local con el mensaje por defecto `Merge branch '...'`).
  - `--no-verify permite saltarse la validación`.
  - `bloquea con un mensaje claro si Bun no está en el PATH` (ejecutar el hook con `sh` y un `PATH` que solo contenga el directorio de `sh`; omitir con `test.skipIf` si Bun resulta alcanzable desde ese PATH; el error menciona Bun y cómo instalarlo).
  - `el hook queda con modo ejecutable y saltos de línea LF en el índice` (`git ls-files -s .githooks/commit-msg` empieza por `100755`; el archivo no contiene `\r`).
  - `prepare instala core.hooksPath en un repositorio Git` (ejecutar `bun <repo real>/scripts/instalar-hooks.ts` con cwd en un repo temporal; `git config --local core.hooksPath` vale `.githooks`).
  - `prepare no falla fuera de un repositorio Git` (cwd en un directorio temporal sin `.git`; código 0 y no se crea `.git`).
  - `prepare no pisa un core.hooksPath ajeno` (configurar `otro-dir`; tras ejecutar sigue `otro-dir`, código 0 y la salida avisa).
- [ ] **Step 2: Run** `bun run test:integration`. Expected: FAIL (no existen el hook ni el script).
- [ ] **Step 3: Implementar** `.githooks/commit-msg` (sh: si `bun` no está disponible, error claro en `stderr` y `exit 1`; si lo está, `exec bun "$(dirname "$0")/../scripts/commit-msg.ts" "$1"`) y `scripts/instalar-hooks.ts` (detectar repo con `git rev-parse --git-dir`; si no hay repo o no hay `git`, salir con 0 sin tocar nada; leer `git config --local core.hooksPath`; si está vacío, fijarlo a `.githooks`; si ya es `.githooks`, no hacer nada; si es otro, avisar por stdout y no pisarlo). Añadir `"prepare": "bun scripts/instalar-hooks.ts"` a `package.json`. Marcar el hook como ejecutable con `git update-index --chmod=+x .githooks/commit-msg` tras `git add`.
- [ ] **Step 3b: Comprobar que `.githooks/commit-msg` se guarda con LF** (`.gitattributes` ya lo impone) y que Prettier/ESLint no lo tocan.
- [ ] **Step 4: Run** `bun run test:integration` y luego `bun run test`. Expected: todo en verde. Si `git merge` no invoca el hook con ese mensaje, anotar un `Ruling:` (el caso sigue siendo válido porque el mensaje está permitido).
- [ ] **Step 5: Comprobar que no se rompe nada:** `bun run format:check && bun run lint && bun run check`. Expected: exit 0.
- [ ] **Step 6: Commit.**

```bash
git add .githooks scripts/instalar-hooks.ts tests/integration/commit-hook.test.ts package.json
git update-index --chmod=+x .githooks/commit-msg
git commit -m "feat: instalar el hook commit-msg al ejecutar bun install"
```

### Task 3: Clon limpio, documentación y PR

**Files:**
- Modify: `docs/04-ingenieria/09-development-guide.md` (sección "Convención de commits": tipos, formato, excepciones, instalación automática y manual `bun run prepare`, `--no-verify`, límites; tabla de scripts: `prepare`; "Antes de cada commit"; totales de pruebas), `docs/05-decisiones/11-decisions-and-risks.md` (ADR-021 + fila), `docs/04-ingenieria/10-testing-and-quality.md` (conteos), `docs/00-estado.md` (H0; siguiente: issue #10), `CLAUDE.md` (hook de commits)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Clon limpio.** `git clone` de la rama a un directorio temporal, **sin** `bun install` previo; ejecutar `bun install --frozen-lockfile`. Expected: `core.hooksPath` queda en `.githooks` sin pasos manuales (`git config --local core.hooksPath`). Dentro del clon: `git commit --allow-empty -m "mal"` (con usuario configurado) es rechazado con un error comprensible; `git commit --allow-empty -m "chore: prueba"` pasa. Anotar la salida del error.
- [ ] **Step 2: Verificar el instalador fuera de Git:** copiar el proyecto sin `.git` (por ejemplo con `git archive`) a un directorio temporal y ejecutar `bun install --frozen-lockfile`. Expected: exit 0 y sin errores de `prepare`.
- [ ] **Step 3: Verificar el historial:** `git log --no-merges --format=%s` filtrado con el validador (script temporal con Bun que importe `validarMensaje`). Expected: solo `init` incumple (el commit inicial, fuera de alcance).
- [ ] **Step 4: Documentación** con Edit (ADR-021: decisión, alternativas commitlint + Husky y Lefthook, consecuencias: solo cabecera, `--no-verify`, el hook no sustituye la validación del servidor (#10), `prepare` no pisa un `core.hooksPath` ajeno, bloquea sin Bun). No afirmar que la CI ya valida commits ni PR.
- [ ] **Step 5: Verificar.** Run: `bun run format:check && bun run lint && bun run check && bun run test`. Expected: exit 0.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "docs: documentar la convención de commits y el ADR-021"
```

- [ ] **Step 7: Revisión independiente, correcciones y PR (pedir confirmación antes del push).** `git push -u origin chore/h0-convencion-commits` y `gh pr create --base dev` con `Closes #9`.

---

## Autorrevisión

- Cubre las 3 tareas de la issue: documentar la convención (T3), hook `commit-msg` con instalación reproducible tras `bun install` (T2), validación de PR en CI (explícitamente diferida a #10 por el responsable).
- Criterio de aceptación: un commit no convencional se rechaza localmente (T2 pasos 1-4 y T3 paso 1 en un clon real).
- Interfaces consistentes: `validarMensaje`, `TIPOS_COMMIT`, `MAX_LONGITUD_CABECERA` definidos en la Task 1 y consumidos por el CLI (Task 1) y el hook (Task 2).
