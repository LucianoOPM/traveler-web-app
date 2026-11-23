# 00 — Estado del proyecto

**Última actualización:** 2026-11-22 (H0 cerrado; H1 en curso)

## Resumen
Proyecto Astro mínimo con configuración validada al arrancar (`src/lib/config.ts`), errores tipados (`src/lib/errors.ts`), `GET /api/health`, CI (`verificar`), PostgreSQL local con Docker Compose (tres bases vacías: privada, demo y pruebas) y Drizzle con scripts `db:*`. Hay esquema de identidad con Better Auth (`src/modules/identity/`) y la migración `0000_identidad`; aún no hay lógica de negocio, handler de autenticación ni inicio de sesión. `admin:create` y `demo:seed` no existen todavía (H1/H6).

## Filosofía (2026-11-22)
La solución más sencilla que resuelva la necesidad actual. Sin infraestructura preventiva ni procesos burocráticos. No se conserva complejidad solo porque ya está hecha. Simplificación integral hecha (documentación, errores, configuración, commits, Drizzle sin rollback, CI y ADR); detalle en los ADR 017 a 023.

## Hitos
Criterios de salida en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | **Cerrado** (README, CI, pruebas, errores, configuración, endpoint de salud) |
| H1 | Plataforma y autenticación | **En curso.** Hecho: Docker Compose con PostgreSQL (#28) Drizzle con migraciones (#29) pruebas con PostgreSQL en CI (#30) y esquema de identidad con Better Auth y migración `0000_identidad` (#31). Faltan, según el [roadmap](01-producto/02-roadmap.md): administrador inicial por script, handler, rutas protegidas y layout administrativo |
| H2 | Catálogo y capacidad | Pendiente |
| H3 | Reservaciones | Pendiente |
| H4 | Pagos y cuentas | Pendiente |
| H5 | Boletos y operaciones | Pendiente |
| H6 | Marketing y seed completo | Pendiente |
| H7 | Demo de visitantes | Pendiente |
| H8 | Endurecimiento y entrega | Pendiente |

## Siguiente paso
Completar H1 (ver los entregables pendientes en la tabla). Antes de asumir decisiones, revisar [pendientes](05-decisiones/pendientes.md).
