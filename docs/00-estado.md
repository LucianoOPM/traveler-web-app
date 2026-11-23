# 00 — Estado del proyecto

**Última actualización:** 2026-11-23 (H0 y H1 cerrados; H2 en curso: esquema del catálogo #50 y Actions de paquetes #51)

## Resumen
Proyecto Astro mínimo con configuración validada al arrancar (`src/lib/config.ts`), errores tipados (`src/lib/errors.ts`), `GET /api/health`, CI (`verificar`), PostgreSQL local con Docker Compose (tres bases vacías: privada, demo y pruebas) y Drizzle con scripts `db:*`. Hay esquema de identidad con Better Auth (`src/modules/identity/`) y la migración `0000_identidad`; el esquema del catálogo (`packages`, `departures`, `boarding_points`, `departure_boarding_points`, módulo `src/modules/catalog/`) y su migración `0001_catalogo` (#50); el handler `/api/auth/*` está montado, hay pantalla `/login`, layout administrativo y `/admin` protegida (acceso solo de personal); las Actions de paquetes (`src/actions/catalog.ts`: crear, editar, publicar, archivar y eliminar borradores, solo admin) con su servicio, repositorio y reglas en `src/modules/catalog/` (#51); aún no hay pantallas ni contenido funcional en el panel. `bun run admin:create` crea el administrador inicial; `demo:seed` no existe todavía (H6).

## Filosofía (2026-11-22)
La solución más sencilla que resuelva la necesidad actual. Sin infraestructura preventiva ni procesos burocráticos. No se conserva complejidad solo porque ya está hecha. Simplificación integral hecha (documentación, errores, configuración, commits, Drizzle sin rollback, CI y ADR); detalle en los ADR 017 a 023.

## Hitos
Criterios de salida en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | **Cerrado** (README, CI, pruebas, errores, configuración, endpoint de salud) |
| H1 | Plataforma y autenticación | **Cerrado** (Docker Compose con PostgreSQL #28, Drizzle con migraciones #29, pruebas con PostgreSQL en CI #30, esquema de identidad y migración `0000_identidad` #31, administrador inicial #43, handler y sesión #44, login, layout y rutas protegidas #45) |
| H2 | Catálogo y capacidad | **En curso**. Seis issues secuenciales: esquema (#50, hecho: migración `0001_catalogo` y pruebas), Actions de paquetes (#51, hecho: infraestructura común de Actions, reglas, servicio, repositorio y pruebas), Actions de salidas (#52), pantallas administrativas (#53), catálogo público (#54) e imágenes (#55) |
| H3 | Reservaciones | Pendiente |
| H4 | Pagos y cuentas | Pendiente |
| H5 | Boletos y operaciones | Pendiente |
| H6 | Marketing y seed completo | Pendiente |
| H7 | Demo de visitantes | Pendiente |
| H8 | Endurecimiento y entrega | Pendiente |

## Siguiente paso
Continuar H2 con la issue #52, Actions de salidas (ver el [roadmap](01-producto/02-roadmap.md) y las decisiones de arquitectura ADR-024, ADR-025 y ADR-026). Antes de asumir decisiones, revisar [pendientes](05-decisiones/pendientes.md).
