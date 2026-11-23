# H3 #66 — Módulo bookings, estados de reserva y migración 0003 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el esquema de reservaciones (3 tablas), la regla única de retención de inventario, la variable `BOOKING_HOLD_HOURS`, la migración `0003_reservaciones` y su documentación.

**Architecture:** Módulo `src/modules/bookings/` con `schema.ts`, `relations.ts`, `types.ts` y `domain/booking-rules.ts`, siguiendo el patrón de `catalog` (constantes `ESTADOS_*` en `schema.ts`, `check()` con `enLista`). La configuración se valida en `comprobarConfiguracion` (ADR-017), no con `astro:env`. Sin `application/` ni `infrastructure/` (no reciben archivos; ADR-026).

**Tech Stack:** Astro 7, Drizzle ORM + drizzle-kit, PostgreSQL, Bun (`bun test`).

**Spec:** issue #66 (`gh issue view 66`) con los ajustes aprobados: PEN-16 **sigue abierto**; `actor_user_id` nullable con `ON DELETE RESTRICT`; sin Actions, servicios, repositorios, pantallas, generación de `reference` ni expiración perezosa.

## Global Constraints

- Conventional Commits en español; sin Python (Node/Bun/bash).
- Migración solo con `bun run db:generate --name reservaciones` → `0003_reservaciones`; solo hacia adelante, sin `down.sql`; sin `organization_id`.
- UUID con `pg_catalog.gen_random_uuid()`, `timestamp` con zona, dinero en centavos `integer`.
- `ESTADOS_RESERVA = ["pendiente", "en_revision", "expirada", "cancelada"]`; categorías `adulto | menor | infante`; eventos `creada | expirada | cancelada | reactivada | token_regenerado`; actores `comprador | admin | sistema`.
- `BOOKING_HOLD_HOURS`: opcional (24 por defecto); si está presente debe ser entero positivo (`/^[1-9]\d*$/`), si no, el arranque falla. Máximo 720 (ajuste final aprobado); constantes `HORAS_RETENCION_POR_DEFECTO` y `HORAS_RETENCION_MAXIMA` en `src/lib/config.ts`.
- No tocar `pendientes.md` ni quitar PEN-16; ADR-028 no declara cerradas las edades de categorías.

## Review Focus

- `BOOKING_HOLD_HOURS=""`, `"0"`, `"-1"`, `"1.5"`, `"24h"`, `" 24"` → problema (prueba en Task 1).
- Reserva `pendiente` con `expires_at` exactamente igual a `ahora` → no retiene (`<=`) (Task 2).
- Reserva `en_revision` con `expires_at` pasado → sigue reteniendo (Task 2).
- Evento `admin` sin `actor_user_id`, o `sistema`/`comprador` con él → rechazado (Task 2).
- Borrar un usuario con eventos asociados → rechazado por `restrict` (Task 2).

---

### Task 1: `BOOKING_HOLD_HOURS` en la configuración

**Files:**
- Modify: `src/lib/config.ts`, `tests/unit/config.test.ts`, `.env.example`

**Interfaces:**
- Produces: `comprobarConfiguracion` rechaza `BOOKING_HOLD_HOURS` presente e inválida con el mensaje `BOOKING_HOLD_HOURS: debe ser un entero positivo (horas)`; ausente es válida.

- [ ] **Step 1: Escribir pruebas en `tests/unit/config.test.ts`**, test `acepta BOOKING_HOLD_HOURS ausente o entero positivo` (`undefined`, `"24"`, `"1"`, `"72"` → `[]`) y test `rechaza BOOKING_HOLD_HOURS inválida sin revelar más que la regla` (`""`, `"0"`, `"-1"`, `"1.5"`, `"24h"`, `" 24"` → `["BOOKING_HOLD_HOURS: debe ser un entero positivo (horas)"]`).
- [ ] **Step 2:** `bun test ./tests/unit/config.test.ts` → FALLA (las inválidas devuelven `[]`).
- [ ] **Step 3:** En `comprobarConfiguracion` (`src/lib/config.ts`), antes del `return`: si `env.BOOKING_HOLD_HOURS !== undefined` y no cumple `/^[1-9]\d*$/`, añadir el problema. Actualizar el comentario de cabecera si hace falta.
- [ ] **Step 4:** Añadir a `.env.example` (antes de `AGENCY_TIMEZONE` o tras él) un comentario y `BOOKING_HOLD_HOURS=24`. `bun test ./tests/unit/config.test.ts` → PASA (incluye la prueba de `.env.example`).
- [ ] **Step 5:** `git add src/lib/config.ts tests/unit/config.test.ts .env.example && git commit -m "feat(config): validar BOOKING_HOLD_HOURS al arrancar (#66)"`

### Task 2: Esquema, regla de retención y migración

**Files:**
- Create: `src/modules/bookings/schema.ts`, `src/modules/bookings/relations.ts`, `src/modules/bookings/types.ts`, `src/modules/bookings/domain/booking-rules.ts`, `src/db/migrations/0003_reservaciones.sql` (+ `meta/`), `tests/unit/bookings/booking-rules.test.ts`, `tests/integration/reservas-esquema.test.ts`
- Modify: `src/db/schema.ts` (exportar `@modules/bookings/schema` y `relations`)

**Interfaces:**
- Produces (`schema.ts`): constantes `ESTADOS_RESERVA`, `CATEGORIAS_TARIFA`, `TIPOS_EVENTO_RESERVA`, `TIPOS_ACTOR`; tablas `bookings`, `bookingPassengers` (`booking_passengers`), `bookingEvents` (`booking_events`).
- Produces (`types.ts`): `Booking`, `NewBooking`, `BookingStatus`, `BookingPassenger`, `NewBookingPassenger`, `BookingEvent`, `NewBookingEvent` con `$inferSelect`/`$inferInsert`.
- Produces (`domain/booking-rules.ts`): `retieneInventario(reserva: Pick<Booking, "status" | "expiresAt">, ahora: Date): boolean`.

**Columnas y restricciones** (nombres de CHECK = `<tabla>_<tema>_check`):
- `bookings`: `id`, `reference` (text, not null, unique), `departure_id` (restrict), `buyer_name`/`buyer_phone`/`buyer_email` (text not null), `boarding_point_id` (restrict), `status` (default `pendiente`), `expires_at` (timestamptz not null), `total_cents` (integer not null), `access_token_hash` (text not null, unique), `created_at`, `updated_at`. CHECK `bookings_status_check`, `bookings_total_check` (`total_cents >= 0`). Índices `bookings_departure_id_status_idx (departure_id, status)` y `bookings_expires_at_status_idx (expires_at, status)`.
- `booking_passengers`: `id`, `booking_id` (cascade), `full_name`, `fare_category`, `price_snapshot_cents`. CHECK `booking_passengers_fare_category_check`, `booking_passengers_price_check` (`>= 0`).
- `booking_events`: `id`, `booking_id` (restrict), `type`, `actor_type`, `actor_user_id` (uuid nullable → `user.id`, restrict), `from_status`/`to_status`/`reason` (text nullable), `created_at`. CHECK `booking_events_type_check`, `booking_events_actor_type_check`, `booking_events_actor_check` (`(actor_type = 'admin') = (actor_user_id is not null)`), `booking_events_from_status_check` y `booking_events_to_status_check` (valores en `ESTADOS_RESERVA` o nulo), `booking_events_token_check` (`type <> 'token_regenerado' or to_status is null`).

- [ ] **Step 1: Escribir `tests/unit/bookings/booking-rules.test.ts`** con `retieneInventario`: `pendiente` con `expiresAt > ahora` → `true`; `pendiente` con `expiresAt == ahora` y `< ahora` → `false`; `en_revision` con `expiresAt` pasado → `true`; `expirada` y `cancelada` (aun con `expiresAt` futuro) → `false`.
- [ ] **Step 2: Escribir `tests/integration/reservas-esquema.test.ts`** (mismo arranque que `catalogo.test.ts`: `abrirBaseDePruebas`, `recrearEsquema`, `migrate`). Helpers: paquete, salida, punto de abordaje, usuario de personal (`insert into "user" (name, email, created_at, updated_at)`), reserva válida con `cambios`. Pruebas: existen las 3 tablas; FKs (`departure_id` y `boarding_point_id` `r`, `booking_passengers.booking_id` `c`, `booking_events.booking_id` y `actor_user_id` `r`); únicos `reference` y `access_token_hash`; índices con sus columnas; defaults (`status = pendiente`); una inserción inválida por restricción (estado, `total_cents = -1`, categoría, precio negativo, tipo de evento, `actor_type`, `admin` sin usuario, `sistema` con usuario, `from_status`/`to_status` inválidos, `token_regenerado` con `to_status`); evento inicial `creada` con `from_status` nulo y `actor_type = 'comprador'` es válido; borrar un usuario con eventos falla; borrar la reserva con eventos falla; borrar una reserva sin eventos borra sus pasajeros.
- [ ] **Step 3:** `bun test ./tests/unit/bookings` → FALLA (módulo no existe). La integración necesita `TEST_DATABASE_URL`; con la base arriba (`docker compose up -d --wait`) también FALLA.
- [ ] **Step 4:** Implementar `schema.ts`, `relations.ts` (bookings↔departures/boardingPoints/passengers/events, events→user), `types.ts` y `domain/booking-rules.ts`; exportar en `src/db/schema.ts`.
- [ ] **Step 5:** `bun run db:generate --name reservaciones`. Revisar el SQL: nombres de CHECK, `ON DELETE`, índices y únicos; comprobar que el journal tiene `0003_reservaciones`.
- [ ] **Step 6:** `bun test ./tests/unit/bookings && bun test ./tests/integration/reservas-esquema.test.ts` → PASAN; luego `bun run check`, `bun run lint`, `bun run format:check`.
- [ ] **Step 7:** `git add src/modules/bookings src/db tests && git commit -m "feat(bookings): esquema de reservaciones, regla de retención y migración 0003 (#66)"`

### Task 3: Documentación

**Files:**
- Modify: `docs/05-decisiones/11-decisions-and-risks.md`, `docs/02-diseno/04-domain-and-database.md`, `docs/04-ingenieria/09-development-guide.md`, `docs/00-estado.md`

- [ ] **Step 1:** ADR-028 (fila en el índice y sección con fecha 2026-11-23, tras ADR-027) con las decisiones de la issue **salvo** categoría declarada/rangos de edad: plazo por `BOOKING_HOLD_HOURS` (24 h, solo reservas nuevas), tope de 10 pasajeros, contacto nombre/teléfono/correo, expiración perezosa sin cron, estados y regla de retención (`retieneInventario`), auditoría solo con `booking_events` (`audit_events` se difiere), cancelar salida con reservas activas → `409`, regeneración de token por el admin, checkout solo invitado. Añadir: `actor_user_id` nullable (comprador/sistema) con `restrict`; las edades de las categorías siguen en PEN-16.
- [ ] **Step 2:** `04-domain-and-database.md`: sustituir las líneas de `bookings` y `booking_passengers` por los campos reales (`reference`, tres campos de contacto, `boarding_point_id`, `updated_at`), añadir `booking_events` y los estados/`retieneInventario`, marcar «implementado, `0003_reservaciones`».
- [ ] **Step 3:** Guía de desarrollo: documentar `BOOKING_HOLD_HOURS` junto a `AGENCY_TIMEZONE` (ejemplo `.env` y lista de variables) y mencionar `reservas-esquema.test.ts` si la guía lista pruebas.
- [ ] **Step 4:** `docs/00-estado.md`: frase en el resumen sobre #66 y H3 en «En curso».
- [ ] **Step 5:** `bun run format:check` → sin diferencias. `git add docs && git commit -m "docs(bookings): ADR-028 y documentar esquema de reservaciones (#66)"`
