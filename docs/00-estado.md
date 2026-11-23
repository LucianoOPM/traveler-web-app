# 00 — Estado del proyecto

**Última actualización:** 2026-11-22 (issue #11: H0 completo en `dev`)

## Resumen
Existe documentación, un [README](../README.md) de arranque y un proyecto Astro mínimo (página de inicio con una island React; scripts `dev`, `build`, `preview`, `check`, `start`, `format`, `format:check`, `lint`, `test`, `test:unit`, `test:integration`, `test:health`; configuración validada al arrancar en `src/lib/config.ts`; errores tipados en `src/lib/errors.ts`; `GET /api/health`; hook `commit-msg` de Conventional Commits en `.githooks/`, instalado por `bun install`; workflow de CI en `.github/workflows/ci.yml` con los jobs `verificar` y `commits`, fusionado en `dev` con el PR #22 y exigido por los rulesets de `dev` y `main`). Aún no hay lógica de negocio, base de datos ni autenticación.

## Hitos
Criterios de salida de cada hito en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | **Completo en dev; cierre formal pendiente de integración a main.** Issues #1 a #11: Astro inicializado (#2), estructura de carpetas (#3), validación de configuración (#4), formato y lint (#5), errores tipados (#6), infraestructura de pruebas (#7), endpoint de salud (#8), convención de commits (#9), CI en GitHub Actions (#10, PR #22; `verificar` y `commits` son checks requeridos en `dev` y `main`) y README de arranque con verificación en clon limpio (#11, aún sin fusionar en `dev`). La primera integración `dev → main` (PR #24) ya ocurrió con la CI en verde, pero sin la issue #11. Ver «Cierre de H0» |
| H1 | Plataforma y autenticación | Pendiente |
| H2 | Catálogo y capacidad | Pendiente |
| H3 | Reservaciones | Pendiente |
| H4 | Pagos y cuentas | Pendiente |
| H5 | Boletos y operaciones | Pendiente |
| H6 | Marketing y seed completo | Pendiente |
| H7 | Demo de visitantes | Pendiente |
| H8 | Endurecimiento y entrega | Pendiente |

## Cierre de H0
Criterio de salida (roadmap): cualquier integrante puede instalar y ejecutar una prueba de salud local.

**Verificación de la issue #11 (2026-11-22).** Se siguió el [README](../README.md) en un clon limpio de la rama, en **otra carpeta de esta misma máquina** (Windows 11, Bun 1.4.4, Node 24.22.0), commit `8ab0613`, sin `.env` ni `node_modules` y con el entorno saneado:
- `bun install --frozen-lockfile`: 403 paquetes en ~42 s; `bun.lock` idéntico al de la rama y `core.hooksPath=.githooks` configurado por `prepare`.
- `bun run test:health`, **sin `.env`**: 6 de 6 pruebas (~6 s).
- `bun run test`, sin `.env`: 64 unitarias y 35 de integración, todas correctas (99); `git status` limpio.
- `bun run build` sin `.env`: falla a propósito y nombra las variables que faltan, sin valores.
- Con `.env` copiado de `.env.example` sin reemplazar `AUTH_SECRET`: `build` falla con «AUTH_SECRET: no puede ser un valor de ejemplo» y sin imprimir el marcador.
- Con un `AUTH_SECRET` de 64 caracteres generado con el comando del README: `build` correcto, y `bun run start` y `bun run dev` responden 200 en `/` y en `/api/health`.

**Límites de esa verificación:** no se probó en otra máquina ni en un sistema distinto de Windows (la CI sí ejecutó el workflow en `ubuntu-latest`, pero no el recorrido del README), y no se probó la hidratación de la island en un navegador.

**Primera integración `dev → main` (PR #24, 2026-11-22).** Se fusionó con `main` en `0c543fe`. **No incluyó la issue #11** (este README y este estado): su rama aún no estaba subida. La CI de esa integración terminó bien:
- En el PR #24, `verificar` y `commits` pasaron.
- En el push a `main` (run `45091158405`), `verificar` terminó en éxito; `commits` se omitió por diseño (solo corre en PR).

Con eso queda comprobada la CI en `main` para el contenido de `dev` de ese momento, pero H0 **no está cerrado**: falta que la issue #11 llegue a `main`.

**Condiciones pendientes para marcar H0 como «Cerrado»:**
1. Fusionar en `dev` el PR de la issue #11.
2. Una segunda integración `dev → main` con un PR, de modo que `main` tenga el README y este estado.
3. Comprobar que la CI de esa integración termina bien (PR y push a `main`).
4. Entonces, un commit de documentación cambia el estado de H0 a «Cerrado»; llegará a `main` con la siguiente integración.

## Scripts y comandos
`db:migrate`, `admin:create`, `demo:seed`: **no existen todavía** (se crean en H1/H6).

## Siguiente paso sugerido
Llevar la issue #11 a `dev` y, con una segunda integración `dev → main`, a `main`, y comprobar su CI para cerrar H0 formalmente (ver «Cierre de H0»); después, empezar H1. Desde la issue #10, todo PR hacia `dev` o `main` necesita que `verificar` y `commits` pasen. PEN-11 resuelto: versiones fijadas en [ADR-015](05-decisiones/11-decisions-and-risks.md) y [guía de desarrollo](04-ingenieria/09-development-guide.md).
