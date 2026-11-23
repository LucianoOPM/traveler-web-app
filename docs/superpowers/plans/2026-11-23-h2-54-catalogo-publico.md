# Catálogo público con Astro SSR (#54) — Plan

**Meta:** un visitante sin sesión ve los paquetes publicados con sus próximas salidas (`/`) y el detalle de un paquete con tarifas, plazas y puntos de abordaje (`/paquetes/<id>`). Nada no publicado es visible. Sin reservas, filtros, paginación ni imágenes (#55). Sin ADR, sin migración, sin dependencias nuevas.

**Arquitectura:** páginas Astro SSR → `PublicCatalogService` (aplicación) → repositorios existentes (`PackageRepository.listPublished()` nuevo; `DepartureRepository.listByPackage`; `BoardingPointRepository.list`) y `DepartureService.availableSeats` para las plazas. Formato en funciones puras de `src/lib/`.

## Decisiones (confirmadas por el usuario)
- HTML semántico y estilos mínimos en `PublicLayout.astro`; no se espera a Tailwind/shadcn (ADR-027 sigue sin instalar).
- Rutas: `/` (lista) y `/paquetes/[id]`; sin slugs.
- Salidas visibles: estado `publicada` y `startsAt > ahora`. Un paquete publicado sin salidas futuras sigue visible («Sin salidas próximas»).
- Plazas solo en el detalle, vía `DepartureService.availableSeats()` (provisional hasta H3; no se duplica la lógica).
- DTO público: sin estados, timestamps ni ids internos (solo el id del paquete, que es la URL).
- `404` uniforme con un único helper (`src/lib/no-encontrado.ts`): id inválido, inexistente, borrador y archivado dan el mismo cuerpo y cabeceras.
- Importes: `centavosAPesos` + `Intl.NumberFormat("es-MX", MXN)` alimentado con el string decimal, sin `number` intermedio. Fechas: `Intl.DateTimeFormat` en `AGENCY_TIMEZONE`.
- Rama `feat/h2-54-catalogo-publico` creada desde `origin/dev` (la rama de integración; `main` local está desfasado y no tiene H2).

## Tareas (TDD: prueba primero, luego código)
1. **Formato:** `formatearPesos` (`src/lib/importes.ts`) y `formatearFecha` (`src/lib/fechas.ts`) + pruebas unitarias (incluye comprobar que Bun acepta strings decimales en `Intl.NumberFormat`).
2. **Repositorio:** `PackageRepository.listPublished()` + `DrizzlePackageRepository` + prueba de integración con la base de pruebas.
3. **Servicio:** `PublicCatalogService` (`list`, `get`) + prueba unitaria (filtrado de paquetes y salidas, DTO sin campos internos, plazas, `NotFoundError`), registrado en `container.ts`.
4. **Páginas:** `PublicLayout.astro`, `index.astro`, `paquetes/[id].astro`, helper `noEncontrado`; retirar `Counter.tsx`.
5. **Integración con la app real** (`tests/integration/catalogo-publico.test.ts`, sin sesión): precios y capacidad correctos, borrador/archivado/cancelada/pasada ocultos, `404` idénticos, un solo `h1`, sin campos internos.
6. **Docs:** sección «Catálogo público (#54)» en la guía y `docs/00-estado.md`. No se cierra H2 (falta #55).

## Fuera de alcance
Reservas, filtros, búsqueda, paginación, imágenes, Tailwind/shadcn, consulta agrupada de plazas (H3).
