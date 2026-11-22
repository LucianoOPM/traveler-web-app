# 00 — Estado del proyecto

**Última actualización:** 2026-11-22

## Resumen
Existe documentación y un proyecto Astro mínimo (página de inicio con una island React; scripts `dev`, `build`, `preview`, `check`, `start`, `format`, `format:check`, `lint`; configuración validada al arrancar en `src/lib/config.ts`). Aún no hay lógica de negocio, base de datos ni autenticación.

## Hitos
Criterios de salida de cada hito en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | En curso (proyecto Astro inicializado, issue #2; estructura de carpetas, issue #3; validación de configuración, issue #4; formato y lint, issue #5) |
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
Continuar H0 con la issue #6 (manejo de errores tipados). PEN-11 resuelto: versiones fijadas en [ADR-015](05-decisiones/11-decisions-and-risks.md) y [guía de desarrollo](04-ingenieria/09-development-guide.md).
