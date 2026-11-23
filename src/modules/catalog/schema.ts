import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Fuente única de los estados: tipos y CHECK salen de aquí. H5 añadirá «en abordaje» y «finalizada».
export const ESTADOS_PAQUETE = ["borrador", "publicado", "archivado"] as const;
export const ESTADOS_SALIDA = ["borrador", "publicada", "cancelada"] as const;

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

export const packages = pgTable(
  "packages",
  {
    id: idUuid(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: ESTADOS_PAQUETE }).notNull().default("borrador"),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
  },
  (t) => [check("packages_status_check", enLista(t.status, ESTADOS_PAQUETE))],
);

export const departures = pgTable(
  "departures",
  {
    id: idUuid(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    adultPriceCents: integer("adult_price_cents").notNull(),
    childPriceCents: integer("child_price_cents").notNull(),
    infantPriceCents: integer("infant_price_cents").notNull(),
    status: text("status", { enum: ESTADOS_SALIDA }).notNull().default("borrador"),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
  },
  (t) => [
    index("departures_package_id_starts_at_idx").on(t.packageId, t.startsAt),
    check("departures_capacity_check", sql`${t.capacity} >= 0`),
    check(
      "departures_prices_check",
      sql`${t.adultPriceCents} >= 0 and ${t.childPriceCents} >= 0 and ${t.infantPriceCents} >= 0`,
    ),
    check("departures_dates_check", sql`${t.endsAt} > ${t.startsAt}`),
    check("departures_status_check", enLista(t.status, ESTADOS_SALIDA)),
  ],
);

export const boardingPoints = pgTable("boarding_points", {
  id: idUuid(),
  name: text("name").notNull().unique(),
  createdAt: creadoEn(),
});

export const departureBoardingPoints = pgTable(
  "departure_boarding_points",
  {
    departureId: uuid("departure_id")
      .notNull()
      .references(() => departures.id, { onDelete: "cascade" }),
    boardingPointId: uuid("boarding_point_id")
      .notNull()
      .references(() => boardingPoints.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.departureId, t.boardingPointId] })],
);
