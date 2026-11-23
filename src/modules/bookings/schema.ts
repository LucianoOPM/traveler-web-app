import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { boardingPoints, departures } from "@modules/catalog/schema";
import { user } from "@modules/identity/schema";

// Fuente única de los valores permitidos: tipos y CHECK salen de aquí.
export const ESTADOS_RESERVA = ["pendiente", "en_revision", "expirada", "cancelada"] as const;
export const CATEGORIAS_TARIFA = ["adulto", "menor", "infante"] as const;
export const TIPOS_EVENTO_RESERVA = [
  "creada",
  "expirada",
  "cancelada",
  "reactivada",
  "token_regenerado",
] as const;
export const TIPOS_ACTOR = ["comprador", "admin", "sistema"] as const;

const idUuid = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const creadoEn = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const actualizadoEn = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
const enLista = (columna: unknown, valores: readonly string[]) =>
  sql`${columna} in (${sql.raw(valores.map((v) => `'${v}'`).join(", "))})`;

export const bookings = pgTable(
  "bookings",
  {
    id: idUuid(),
    // Código legible para el comprador; distinto del id. Lo genera el servicio de reservas (H3).
    reference: text("reference").notNull().unique(),
    departureId: uuid("departure_id")
      .notNull()
      .references(() => departures.id, { onDelete: "restrict" }),
    buyerName: text("buyer_name").notNull(),
    buyerPhone: text("buyer_phone").notNull(),
    buyerEmail: text("buyer_email").notNull(),
    boardingPointId: uuid("boarding_point_id")
      .notNull()
      .references(() => boardingPoints.id, { onDelete: "restrict" }),
    status: text("status", { enum: ESTADOS_RESERVA }).notNull().default("pendiente"),
    // En `en_revision` se conserva pero no expira: la regla está en `domain/booking-rules.ts`.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    totalCents: integer("total_cents").notNull(),
    // Solo el hash; el token en claro nunca se guarda.
    accessTokenHash: text("access_token_hash").notNull().unique(),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
  },
  (t) => [
    index("bookings_departure_id_status_idx").on(t.departureId, t.status),
    index("bookings_expires_at_status_idx").on(t.expiresAt, t.status),
    check("bookings_status_check", enLista(t.status, ESTADOS_RESERVA)),
    check("bookings_total_check", sql`${t.totalCents} >= 0`),
  ],
);

export const bookingPassengers = pgTable(
  "booking_passengers",
  {
    id: idUuid(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    fareCategory: text("fare_category", { enum: CATEGORIAS_TARIFA }).notNull(),
    priceSnapshotCents: integer("price_snapshot_cents").notNull(),
  },
  (t) => [
    check("booking_passengers_fare_category_check", enLista(t.fareCategory, CATEGORIAS_TARIFA)),
    check("booking_passengers_price_check", sql`${t.priceSnapshotCents} >= 0`),
  ],
);

// Append-only por convención del servicio. Nunca guarda tokens ni hashes.
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: idUuid(),
    // restrict: la auditoría no se borra con la reserva.
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    type: text("type", { enum: TIPOS_EVENTO_RESERVA }).notNull(),
    actorType: text("actor_type", { enum: TIPOS_ACTOR }).notNull(),
    // Solo personal (`admin`); comprador invitado y sistema no tienen usuario.
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "restrict" }),
    fromStatus: text("from_status", { enum: ESTADOS_RESERVA }),
    toStatus: text("to_status", { enum: ESTADOS_RESERVA }),
    reason: text("reason"),
    createdAt: creadoEn(),
  },
  (t) => [
    check("booking_events_type_check", enLista(t.type, TIPOS_EVENTO_RESERVA)),
    check("booking_events_actor_type_check", enLista(t.actorType, TIPOS_ACTOR)),
    check(
      "booking_events_actor_check",
      sql`(${t.actorType} = 'admin') = (${t.actorUserId} is not null)`,
    ),
    // NULL pasa un CHECK: los estados nulos son válidos (evento inicial, token regenerado).
    check("booking_events_from_status_check", enLista(t.fromStatus, ESTADOS_RESERVA)),
    check("booking_events_to_status_check", enLista(t.toStatus, ESTADOS_RESERVA)),
    check(
      "booking_events_token_check",
      sql`${t.type} <> 'token_regenerado' or ${t.toStatus} is null`,
    ),
  ],
);
