# 04 — Dominio y base de datos

## Entidades lógicas propuestas
| Área | Entidades | Relaciones importantes |
|---|---|---|
| Catálogo | `packages`, `departures`, `boarding_points`, `departure_boarding_points` | Paquete 1:N salidas; salida N:M puntos disponibles |
| Reservas | `bookings`, `booking_passengers`, `booking_events` | Reserva N:1 salida, 1:N pasajeros |
| Bancos | `bank_accounts`, `bank_allocations`, `bank_allocation_events` | Reserva 0..1 asignación vigente; instrucciones congeladas |
| Pagos | `payment_reports`, `payment_evidence`, `payment_reviews`, `cash_payments` | Reportes y revisiones con historial; no confundir reporte con ingreso |
| Boletos | `tickets` | Pasajero 0..1 boleto vigente por reserva/salida |
| Operación | `boarding_records` | `ticket_id` único para registro válido |
| Medios (módulo `media`) | `media_assets` | Referenciado por `packages.cover_asset_id`; marketing lo reutilizará en H6 |
| Marketing | `flyer_templates`, `flyer_projects`, `flyer_exports` | Exportaciones asociadas a proyecto y, si aplica, salida |
| Demo | `demo_invitations`, `demo_sessions` | Invitación 0..1 consumo; sesión ligada a invitación |
| Control | `audit_events` | Actor, acción, entidad, antes/después saneado, timestamp |

## Campos de alto valor
- `packages` (implementado, `0001_catalogo`): `id`, `name`, `summary`, `description`, `status` (`borrador | publicado | archivado`, por defecto `borrador`), `cover_asset_id` (nullable, FK a `media_assets`, `on delete restrict`), `created_at`, `updated_at`.
- `media_assets` (implementado, `0002_imagenes`): `id`, `storage_key` (único; `media/<uuid>.<ext>` generado por el servidor), `content_type` (`image/jpeg | image/png | image/webp`), `size_bytes` (`> 0`), `created_at`. El nombre del archivo del cliente no se guarda.
- `departures` (implementado): `package_id` (`on delete restrict`), `starts_at`, `ends_at`, `capacity`, `adult_price_cents`, `child_price_cents`, `infant_price_cents`, `status` (`borrador | publicada | cancelada`, por defecto `borrador`), `created_at`, `updated_at`. `CHECK`: `capacity >= 0`, tarifas `>= 0`, `ends_at > starts_at` y estados limitados; «en abordaje» y «finalizada» se añaden en H5.
- `boarding_points` (implementado): `id`, `name` (único), `created_at`. `departure_boarding_points`: `departure_id` (cascade) y `boarding_point_id` (restrict), clave primaria compuesta (única por pareja).
- Tipos TypeScript del catálogo: inferidos con `$inferSelect`/`$inferInsert` en `src/modules/catalog/types.ts` (`Package`, `NewPackage`, `Departure`, ...); no se duplican a mano.
- `bookings` (implementado, `0003_reservaciones`, módulo `src/modules/bookings/`): `id`, `reference` (código legible, único, distinto del id), `departure_id` y `boarding_point_id` (ambos `on delete restrict`), `buyer_name`, `buyer_phone`, `buyer_email` (los tres obligatorios), `status` (`pendiente | en_revision | expirada | cancelada`, por defecto `pendiente`), `expires_at` (obligatorio; se conserva en `en_revision` pero allí se ignora), `total_cents` (`>= 0`), `access_token_hash` (único; nunca el token), `created_at`, `updated_at`. Índices `(departure_id, status)` y `(expires_at, status)`.
- `booking_passengers` (implementado): `booking_id` (cascade), `full_name`, `fare_category` (`adulto | menor | infante`), `price_snapshot_cents` (`>= 0`). Las edades de cada categoría siguen abiertas (PEN-16).
- `booking_events` (implementado, append-only): `booking_id` (`restrict`), `type` (`creada | expirada | cancelada | reactivada | token_regenerado`), `actor_type` (`comprador | admin | sistema`), `actor_user_id` (nullable, FK a `user` con `restrict`; obligatorio si `actor_type = 'admin'` y nulo en los demás), `from_status` y `to_status` (nullables, limitados a los estados de reserva; `to_status` nulo en `token_regenerado`), `reason`, `created_at`. Nunca guarda tokens ni hashes.
- **Retención de inventario** (`retieneInventario(reserva, ahora)` en `domain/booking-rules.ts`, única definición): `pendiente` retiene solo mientras `expires_at > ahora` (aunque aún no esté marcada `expirada`); `en_revision` retiene siempre y no expira (H3 no la asigna; la transición llega en H4); `expirada` y `cancelada` no retienen. Todos los pasajeros ocupan lugar, infantes incluidos.
- `bank_accounts`: `priority`, `monthly_limit_cents`, `is_eligible`, datos de cuenta ficticios o privados según entorno.
- `bank_allocations`: `booking_id`, `bank_account_id`, `amount_cents`, `calendar_month`, `status`, `instruction_snapshot`.
- `payment_reports`: `booking_id`, `reported_amount_cents`, `status`, `submitted_at`.
- `payment_reviews`: `payment_report_id`, `reviewer_id`, `decision`, `reason`, `verified_amount_cents`, `created_at`.
- `tickets`: `passenger_id`, `booking_id`, `token_hash`, `status`, `issued_at`.
- `boarding_records`: `ticket_id`, `departure_id`, `operator_id`, `boarded_at`.
- `demo_invitations`: `token_hash`, `expires_at`, `consumed_at`, `revoked_at`.
- `demo_sessions`: `invitation_id`, `session_token_hash`, `watermark_code`, `expires_at`, `revoked_at`.

## Restricciones esenciales
1. `capacity >= 0`; tarifas e importes no negativos.
2. Número de pasajeros que ocupan lugar = adultos + menores + infantes.
3. No exceder capacidad por reservas que retienen inventario.
4. `boarding_records.ticket_id` único.
5. No emitir boleto antes de liquidación verificada; verificar en servicio transaccional.
6. Una asignación bancaria vigente por reserva y por el importe total; no dividir entre cuentas.
7. Límite bancario mensual no excedido; operación atómica con bloqueos adecuados.
8. Tokens solo como hash, nunca en texto plano en BD.
9. No usar `organization_id` ni tablas de tenants.

## Índices iniciales sugeridos
`departures(package_id, starts_at)`, `bookings(departure_id, status)`, `bookings(expires_at, status)`, `payment_reports(booking_id, status)`, `bank_allocations(bank_account_id, calendar_month, status)`, `tickets(token_hash) UNIQUE`, `demo_sessions(session_token_hash) UNIQUE`.

## Nota de diseño
Las tablas y nombres son **propuestos**, sujetos a ajustes en migraciones. Los importes comprometidos/reportados/verificados/liberados requieren definición explícita de contabilidad operacional antes de construir el servicio de asignación. No usar agregaciones ingenuas que cuenten dos veces un comprobante reemplazado.
