# 00 — Estado del proyecto

**Última actualización:** 2026-11-22

## Resumen
Existe documentación y un proyecto Astro mínimo (página de inicio con una island React; scripts `dev`, `build`, `preview`, `check`, `start`, `format`, `format:check`, `lint`, `test`, `test:unit`, `test:integration`, `test:health`; configuración validada al arrancar en `src/lib/config.ts`; errores tipados en `src/lib/errors.ts`; `GET /api/health`; hook `commit-msg` de Conventional Commits en `.githooks/`, instalado por `bun install`; workflow de CI en `.github/workflows/ci.yml` con los jobs `verificar` y `commits`, aún sin ejecutarse en GitHub ni exigido por los rulesets). Aún no hay lógica de negocio, base de datos ni autenticación.

## Hitos
Criterios de salida de cada hito en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | En curso (proyecto Astro inicializado, issue #2; estructura de carpetas, issue #3; validación de configuración, issue #4; formato y lint, issue #5; errores tipados, issue #6; infraestructura de pruebas, issue #7; endpoint de salud, issue #8; convención de commits, issue #9; CI en GitHub Actions, issue #10: implementada y verificada en local, pendiente de ver ambos jobs en verde en un PR hacia `dev`) |
| H1 | Plataforma y autenticación | Pendiente |
| H2 | Catálogo y capacidad | Pendiente |
| H3 | Reservaciones | Pendiente |
| H4 | Pagos y cuentas | Pendiente |
| H5 | Boletos y operaciones | Pendiente |
| H6 | Marketing y seed completo | Pendiente |
| H7 | Demo de visitantes | Pendiente |
| H8 | Endurecimiento y entrega | Pendiente |

## Scripts y comandos
`db:migrate`, `admin:create`, `demo:seed`: **no existen todavía** (se crean en H1/H6).

## Siguiente paso sugerido
Cerrar la issue #10: abrir el PR hacia `dev` y comprobar que `verificar` y `commits` pasan; después proponer al responsable añadirlos como checks requeridos en `proteger-dev` y `proteger-main` (solo con su aprobación). La validación del workflow en `main` queda pendiente hasta la integración `dev → main` al cierre de H0; H0 no se da por cerrado hasta cumplir sus criterios de salida. Después, la issue #11 (README de arranque y cierre de H0). PEN-11 resuelto: versiones fijadas en [ADR-015](05-decisiones/11-decisions-and-risks.md) y [guía de desarrollo](04-ingenieria/09-development-guide.md).
