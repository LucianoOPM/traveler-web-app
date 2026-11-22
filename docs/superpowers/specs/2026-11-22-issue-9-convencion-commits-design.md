# Issue #9 — Convención de commits (Conventional Commits) con verificación (diseño)

**Aprobado por el responsable en la conversación (2026-11-22): opción 1 (script propio sin dependencias).** Tamaño: cambio pequeño-mediano (un validador, un hook, un script de instalación, pruebas y documentación).

## Intención
Que un commit con mensaje no convencional se rechace **localmente**, y que el hook se instale solo tras `bun install` en un clon Git. Criterio de aceptación de la issue: un commit con mensaje no convencional es rechazado localmente.

## Metas
- `scripts/commit-msg.ts`: validador reutilizable (también lo usará la CI de la issue #10) y CLI que lee el archivo de mensaje que Git entrega al hook.
- `.githooks/commit-msg`: envoltorio mínimo versionado que invoca al validador con Bun.
- `scripts/instalar-hooks.ts`, ejecutado por el script `prepare` de `package.json`: configura `core.hooksPath` a `.githooks`.
- Pruebas unitarias del validador y prueba de integración con un repositorio Git temporal real.
- Documentación de la convención en la guía de desarrollo y ADR-021.

## No metas
`commitlint`, Husky, Lefthook u otra dependencia; validar cuerpo o pie del mensaje; validar títulos de PR o commits en el servidor (issue #10); `commit-msg` para otras ramas del flujo; reescribir el historial.

## Anti-metas
Que el hook bloquee commits legítimos de Git (merges, reverts automáticos, `fixup!`); que `bun install` falle fuera de un repositorio Git; que `prepare` pise una configuración de hooks ajena sin avisar.

## Hechos verificados
- `bun install` ejecuta los scripts `preinstall`, `postinstall` y `prepare` del propio proyecto (Context7, docs de Bun); `--ignore-scripts` o `install.ignoreScripts` los desactivan.
- Todos los commits propios del historial (sin merges) cumplen el formato salvo el inicial `init`; la cabecera más larga mide exactamente 100 caracteres. Los merges de GitHub (`Merge pull request #N from ...`) no son convencionales.
- No hay `core.hooksPath` ni hooks activos hoy; Bun está en el PATH de Git en esta máquina.
- Con merge commits (ADR-016) el título del PR no pasa a ser un mensaje de commit.

## Decisiones tomadas (del responsable)
- Tipos: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`, `build`, `ci`, `revert`.
- Formato de la cabecera: `type(scope)!: descripción`, con scope y `!` opcionales (también `type!: descripción`). Scope en minúsculas y sin lista cerrada (`h0`, `payments`, `demo`, `db`). Descripción obligatoria y no vacía. Cabecera de hasta **100 caracteres**. Descripción en español o inglés.
- Excepciones permitidas sin más validación: la cabecera empieza por `Merge `, `Revert "` (reverts automáticos de Git), `fixup! `, `squash! ` o `amend! `.
- Bun ausente: el hook **bloquea** el commit con un mensaje claro. `--no-verify` queda permitido como escape local deliberado.
- Solo se valida la **cabecera** (primera línea no vacía y que no sea un comentario `#`); cuerpo y pie se ignoran.
- Si no hay repositorio Git, `prepare` termina con éxito sin modificar nada.
- La validación obligatoria en el servidor y de los títulos de PR se deja para la issue #10, reutilizando el mismo validador.

## Decisiones mías (a revisar)
- Si ya hay un `core.hooksPath` local distinto de `.githooks`, `prepare` **no lo pisa**: avisa y lo deja (decisión conservadora; se documenta cómo cambiarlo a mano).
- `prepare` es un script (`scripts/instalar-hooks.ts`) y no una línea en `package.json`, para poder probarlo y mantener la lógica legible.
- `validarMensaje` devuelve `string | null` (texto del error en español, con tipos válidos y un ejemplo; `null` si es válido).
- ADR-021 registra la elección frente a commitlint + Husky y Lefthook.

## Enfoques
1. **Script propio + `core.hooksPath` versionado (elegido):** sin dependencias; el mismo validador sirve a la CI.
2. **commitlint + Husky:** estándar de la industria con reglas de cuerpo y pie, pero 3 dependencias (y muchas transitivas) para una convención que solo exige la cabecera.
3. **Lefthook:** gestor de hooks más general de lo que hace falta.

## A cargo del constructor
Expresión regular exacta (según las decisiones); redacción del mensaje de error; detalles de las pruebas de integración con Git temporal; redacción de la guía y del ADR.
