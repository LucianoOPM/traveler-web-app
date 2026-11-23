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
- `booking_events` (implementado, append-only): `booking_id` (`restrict`), `type` (`creada | expirada | cancelada | reactivada | token_regenerado`), `actor_type` (`comprador | admin | sistema`), `actor_user_id` (nullable, FK a `user` con `restrict`; obligatorio si `actor_type = 'admin'` y nulo en los demás), `from_status` y `to_status` (nullables, limitados a los estados de reserva; `to_status` nulo en `token_regenerado`), `reason`, `created_at`. Nunca guarda tokens ni hashes. Append-only solo por convención de los servicios: la base no lo impide (sin trigger; ver ADR-028).
- **Retención de inventario** (`retieneInventario(reserva, ahora)` en `domain/booking-rules.ts`, única definición): `pendiente` retiene solo mientras `expires_at > ahora` (aunque aún no esté marcada `expirada`); `en_revision` retiene siempre y no expira (H3 no la asigna; la transición llega en H4); `expirada` y `cancelada` no retienen. Todos los pasajeros ocupan lugar, infantes incluidos.
- **Creación de reserva** (`BookingService.create`, #67): una sola transacción que bloquea la fila de la salida con `SELECT … FOR UPDATE` (único mecanismo de serialización) y dentro de ella comprueba salida `publicada`, paquete `publicado` y `starts_at` futura, que el punto esté asignado a la salida y la capacidad (retenidos según `retieneInventario` + pasajeros nuevos <= capacidad); inserta reserva, pasajeros con `price_snapshot_cents`, `total_cents` y el evento `creada` (actor `comprador`). `expires_at = min(ahora + BOOKING_HOLD_HOURS, starts_at)`. De 1 a 10 pasajeros; sin validar edades (PEN-16). Referencia `TT-XXXXXXXX` (8 caracteres sin ambigüedades; hasta 3 intentos ante colisión). El token (32 bytes aleatorios) se devuelve una sola vez y solo se guarda su hash SHA-256. Errores: capacidad `409 capacity_exceeded`; salida, punto o reglas inválidos `422`.
- **Ciclo de vida** (#70, sin migración: el esquema de #66 ya cubría los eventos): expiración perezosa con evento `expirada` (actor `sistema`), cancelación, reactivación y regeneración de token solo por admin (eventos `cancelada`, `reactivada` y `token_regenerado` con `actor_type = admin`, `actor_user_id` y `reason`). Todo bajo el mismo `SELECT … FOR UPDATE` de la salida; las transiciones usan `update … where status = <origen>`. Reglas en [05-business-rules](05-business-rules.md).
- **Concurrencia verificada** (#71): todas las operaciones que tocan las reservas de una salida (crear, cancelar, reactivar, regenerar token, y editar o cancelar la salida) toman el mismo `SELECT … FOR UPDATE` de la fila de la salida y calculan el inventario retenido dentro de esa transacción. Se probó con conexiones independientes sobre PostgreSQL real que no hay sobreventa, que el precio queda el vigente al obtener el bloqueo, que las operaciones repetidas no duplican eventos ni renuevan el vencimiento y que un token regenerado invalida al anterior al confirmarse.
- **H4 (ADR-029), esquema por definir en su primera issue.** Estados de reserva nuevos `parcial` y `pagada` (CHECK de `bookings` y de `booking_events`, más tipos de evento de pago); `retieneInventario` pasa a retener en `en_revision`, `parcial` y `pagada`, y `expirarVencidas` sigue afectando solo a `pendiente`.
- `bank_accounts`: `priority`, `monthly_limit_cents`, `is_eligible`, datos de cuenta ficticios o privados según entorno.
- `bank_allocations`: `booking_id`, `bank_account_id`, `amount_cents` (total de la reserva), `calendar_month` (mes en `AGENCY_TIMEZONE` al crearla), `status` (`vigente | liberada`), `instruction_snapshot`; una `vigente` por reserva (índice único parcial). Comprometido del mes = suma de `amount_cents` de las `vigente` de la cuenta en ese mes.
- `payment_reports`: `booking_id`, `reported_amount_cents`, `status`, `submitted_at`; evidencia privada vía `media_assets` (imágenes y PDF), servida solo por una ruta de admin, nunca por `/api/media`. Un reemplazo conserva el reporte anterior (historial) sin crear un movimiento nuevo.
- `payment_reviews`: `payment_report_id`, `reviewer_id`, `decision`, `reason`, `verified_amount_cents`, `created_at`.
- **Sin libro mayor aparte:** la fuente de verdad son los reportes SPEI verificados y los cobros en efectivo del admin (`cash_payments`); historial, liquidación y conciliación se derivan de ellos. Un movimiento verificado es inmutable. El esquema exacto se fija en la primera issue de H4. Reglas de cuentas (límite, deshabilitar) y de mes de asignación: [05-business-rules](05-business-rules.md).
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
Las tablas y nombres son **propuestos**, sujetos a ajustes en migraciones. Los importes comprometidos/reportados/verificados/liberados están definidos en [05-business-rules](05-business-rules.md) y ADR-029. No usar agregaciones ingenuas que cuenten dos veces un comprobante reemplazado.
