# 00 — Estado del proyecto

**Última actualización:** 2026-11-22 (H0 cerrado; H1 en curso, issue #28)

## Resumen
Existe documentación, un [README](../README.md) de arranque y un proyecto Astro mínimo (página de inicio con una island React; scripts `dev`, `build`, `preview`, `check`, `start`, `format`, `format:check`, `lint`, `test`, `test:unit`, `test:integration`, `test:health`; configuración validada al arrancar en `src/lib/config.ts`; errores tipados en `src/lib/errors.ts`; `GET /api/health`; hook `commit-msg` de Conventional Commits en `.githooks/`, instalado por `bun install`; workflow de CI en `.github/workflows/ci.yml` con los jobs `verificar` y `commits`, fusionado en `dev` con el PR #22 y exigido por los rulesets de `dev` y `main`). Desde la issue #28 (H1) hay un `docker-compose.yml` con PostgreSQL local (tres bases vacías: privada, demo y pruebas). Aún no hay lógica de negocio, esquema, migraciones ni autenticación.

## Hitos
Criterios de salida de cada hito en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | **Cerrado.** Issues #1 a #11: Astro inicializado (#2), estructura de carpetas (#3), validación de configuración (#4), formato y lint (#5), errores tipados (#6), infraestructura de pruebas (#7), endpoint de salud (#8), convención de commits (#9), CI en GitHub Actions (#10, PR #22; `verificar` y `commits` son checks requeridos en `dev` y `main`) y README de arranque con verificación en clon limpio (#11, PR #25). Integrado en `main` con los PR #24 y #26, con la CI en verde. Ver «Cierre de H0» |
| H1 | Plataforma y autenticación | **En curso.** Diseño de las issues #28 a #31 en `docs/superpowers/specs/2026-11-22-h1-issues-1-4-base-de-datos-design.md`. #28 (Docker Compose con PostgreSQL y las tres bases) implementada y verificada con Docker; siguen #29 (Drizzle y rollback), #30 (pruebas con PostgreSQL, PEN-15) y #31 (identidad) |
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

Esa integración comprobó la CI en `main`, pero H0 seguía abierto porque faltaba que la issue #11 llegara a `main`.

**Segunda integración `dev → main` (PR #26, 2026-11-22).** El PR #25 (issue #11) se fusionó en `dev` y el PR #26 llevó `dev` a `main` (`312eee0`), que ya incluye el README y el estado de H0:
- En el PR #26, `verificar` y `commits` pasaron.
- En el push a `main` (run `45091674281`), `verificar` terminó en éxito; `commits` se omitió por diseño (solo corre en PR).
- Desde un clon limpio de `main` (en otra carpeta de esta misma máquina), `bun install --frozen-lockfile` (403 paquetes, `bun.lock` intacto, hook instalado) y `bun run test:health` sin `.env` (6 de 6) terminaron bien.

**H0 cerrado (2026-11-22).** Se cumplieron las condiciones fijadas: issue #11 fusionada en `dev`, integración `dev → main` y CI de `main` en verde (PR y push). Este cambio de estado se registra en `dev` y llegará a `main` con la siguiente integración. Siguen vigentes los límites de la verificación: no se probó en otra máquina ni sistema operativo, ni la hidratación de la island en un navegador.

## Scripts y comandos
`db:migrate`, `admin:create`, `demo:seed`: **no existen todavía** (se crean en H1/H6).

## Siguiente paso sugerido
Continuar H1 con la issue #29 (Drizzle, `db:migrate` y ejecutor de rollback; ver [02-roadmap](01-producto/02-roadmap.md) y el diseño de H1). H0 está cerrado (ver «Cierre de H0»). Antes de asumir decisiones de H1, revisar [pendientes](05-decisiones/pendientes.md). Desde la issue #10, todo PR hacia `dev` o `main` necesita que `verificar` y `commits` pasen. PEN-11 resuelto: versiones fijadas en [ADR-015](05-decisiones/11-decisions-and-risks.md) y [guía de desarrollo](04-ingenieria/09-development-guide.md).
