# 00 — Estado del proyecto

**Última actualización:** 2026-11-22 (H0 cerrado; H1 en curso; simplificación integral en marcha)

## Resumen
Proyecto Astro mínimo con configuración validada al arrancar (`src/lib/config.ts`), errores tipados (`src/lib/errors.ts`), `GET /api/health`, CI (`verificar` y `commits`), PostgreSQL local con Docker Compose (tres bases vacías: privada, demo y pruebas) y Drizzle con scripts `db:*`. Aún no hay lógica de negocio, esquema, migraciones reales ni autenticación. `admin:create` y `demo:seed` no existen todavía (H1/H6).

## Filosofía (2026-11-22)
La solución más sencilla que resuelva la necesidad actual. Sin infraestructura preventiva ni procesos burocráticos. No se conserva complejidad solo porque ya está hecha. En curso: simplificación integral en 6 cambios (documentación y ruido, errores, configuración, commits, Drizzle sin rollback, CI y ADR).

## Hitos
Criterios de salida en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | **Cerrado** (README, CI, pruebas, errores, configuración, endpoint de salud) |
| H1 | Plataforma y autenticación | **En curso.** Hecho: Docker Compose con PostgreSQL (#28) y Drizzle con migraciones (#29). Siguen #30 (CI con PostgreSQL) y #31 (identidad con Better Auth) |
| H2 | Catálogo y capacidad | Pendiente |
| H3 | Reservaciones | Pendiente |
| H4 | Pagos y cuentas | Pendiente |
| H5 | Boletos y operaciones | Pendiente |
| H6 | Marketing y seed completo | Pendiente |
| H7 | Demo de visitantes | Pendiente |
| H8 | Endurecimiento y entrega | Pendiente |

## Siguiente paso
Terminar la simplificación y volver al desarrollo: issues #30 y #31. Antes de asumir decisiones, revisar [pendientes](05-decisiones/pendientes.md).
