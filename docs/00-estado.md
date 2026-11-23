# 00 — Estado del proyecto

**Última actualización:** 2026-11-23 (H0, H1 y H2 cerrados; H2: esquema #50, Actions de paquetes #51 y de salidas #52, pantallas administrativas #53, catálogo público #54, imágenes #55)

## Resumen
Proyecto Astro mínimo con configuración validada al arrancar (`src/lib/config.ts`), errores tipados (`src/lib/errors.ts`), `GET /api/health`, CI (`verificar`), PostgreSQL local con Docker Compose (tres bases vacías: privada, demo y pruebas) y Drizzle con scripts `db:*`. Hay esquema de identidad con Better Auth (`src/modules/identity/`) y la migración `0000_identidad`; el esquema del catálogo (`packages`, `departures`, `boarding_points`, `departure_boarding_points`, módulo `src/modules/catalog/`) y su migración `0001_catalogo` (#50); el handler `/api/auth/*` está montado, hay pantalla `/login`, layout administrativo y `/admin` protegida (acceso solo de personal); las Actions de paquetes (`src/actions/catalog.ts`: crear, editar, publicar, archivar y eliminar borradores, solo admin) con su servicio, repositorio y reglas en `src/modules/catalog/` (#51); las Actions de salidas, tarifas, capacidad y puntos de abordaje (mismo módulo; servicios `DepartureService` y `BoardingPointService`, #52); las pantallas administrativas del catálogo (`/admin/catalogo`, solo admin; operador `403`): lista, crear y editar paquete, y vista del paquete con sus salidas, publicar, cancelar y puntos de abordaje, con importes en pesos y fechas en la zona de la agencia (#53). El catálogo público (`/` y `/paquetes/<id>`, SSR, sin sesión) muestra solo paquetes y salidas publicados, con tarifas, plazas (provisional: capacidad) y puntos de abordaje (#54). Cada paquete puede tener una portada (módulo compartido `src/modules/media/`, migración `0002_imagenes`): el admin la sube validada por firma (JPEG, PNG o WebP, máx. 5 MiB), se guarda fuera de `public/` y `GET /api/media/<id>` solo la sirve si el paquete está publicado (el admin ve también borradores), con texto alternativo en el panel y el catálogo (#55). `bun run admin:create` crea el administrador inicial; `demo:seed` no existe todavía (H6).

## Filosofía (2026-11-22)
La solución más sencilla que resuelva la necesidad actual. Sin infraestructura preventiva ni procesos burocráticos. No se conserva complejidad solo porque ya está hecha. Simplificación integral hecha (documentación, errores, configuración, commits, Drizzle sin rollback, CI y ADR); detalle en los ADR 017 a 023.

## Hitos
Criterios de salida en [02-roadmap](01-producto/02-roadmap.md).

| Hito | Descripción | Estado |
|---|---|---|
| H0 | Preparación y disciplina | **Cerrado** (README, CI, pruebas, errores, configuración, endpoint de salud) |
| H1 | Plataforma y autenticación | **Cerrado** (Docker Compose con PostgreSQL #28, Drizzle con migraciones #29, pruebas con PostgreSQL en CI #30, esquema de identidad y migración `0000_identidad` #31, administrador inicial #43, handler y sesión #44, login, layout y rutas protegidas #45) |
| H2 | Catálogo y capacidad | **Cerrado**. Seis issues secuenciales: esquema (#50, hecho: migración `0001_catalogo` y pruebas), Actions de paquetes (#51, hecho: infraestructura común de Actions, reglas, servicio, repositorio y pruebas), Actions de salidas (#52, hecho: reglas, servicios, repositorios, puntos de abordaje y pruebas; `availableSeats` es provisional hasta H3), pantallas administrativas (#53, hecho: páginas SSR, islands, conversión de importes y fechas, 403 al operador y pruebas; validación manual en Chrome hecha el 2026-11-23, sin prueba de navegador automatizada), catálogo público (#54, hecho: páginas SSR `/` y `/paquetes/<id>`, `PublicCatalogService`, `404` uniforme, formato de importes y fechas y pruebas con la app real; estilos mínimos, sin Tailwind todavía) e imágenes (#55, hecho: módulo `media`, `media_assets` y migración `0002_imagenes`, subida validada por firma, `GET /api/media/<id>` con visibilidad por estado y portadas en panel y catálogo; límites de cuerpo de Astro y del adaptador en 6 MiB; pruebas con la app real y un directorio temporal; la island de subida se validó el 2026-11-23 en Chrome real con un script CDP desechable, sin prueba de navegador automatizada en CI: PEN-13 sigue abierto) |
| H3 | Reservaciones | Pendiente |
| H4 | Pagos y cuentas | Pendiente |
| H5 | Boletos y operaciones | Pendiente |
| H6 | Marketing y seed completo | Pendiente |
| H7 | Demo de visitantes | Pendiente |
| H8 | Endurecimiento y entrega | Pendiente |

## Siguiente paso
H2 está cerrado. Siguiente: H3, reservaciones (ver el [roadmap](01-producto/02-roadmap.md) y las decisiones de arquitectura ADR-024, ADR-025 y ADR-026). La interfaz usa Tailwind CSS v4 y shadcn/ui ([ADR-027](05-decisiones/11-decisions-and-risks.md)), instalados en #65 junto con la migración de login, panel, catálogo de administración y catálogo público; toda interfaz nueva parte de ahí. Antes de H3, revisar las reglas de edición de salidas publicadas (ver la guía de desarrollo). Antes de asumir decisiones, revisar [pendientes](05-decisiones/pendientes.md).
