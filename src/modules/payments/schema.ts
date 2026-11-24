import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "@modules/bookings/schema";
import { user } from "@modules/identity/schema";
import { mediaAssets } from "@modules/media/schema";

// Fuente única de los valores permitidos: tipos y CHECK salen de aquí.
export const ESTADOS_ASIGNACION = ["vigente", "liberada"] as const;
export const ESTADOS_REPORTE = ["pendiente", "verificado", "rechazado", "reemplazado"] as const;
export const DECISIONES_REVISION = ["verificado", "rechazado"] as const;
export const TIPOS_CASO = ["sin_cuenta_elegible", "cancelada_con_pago_verificado"] as const;
export const ESTADOS_CASO = ["abierto", "resuelto"] as const;

// El `jsonb` de Drizzle con bun-sql guarda el objeto como cadena JSON dentro del jsonb (doble
// codificación) y `->` no funciona. Sin `toDriver`, Bun lo codifica una sola vez como jsonb real.
const jsonb = customType<{ data: Record<string, unknown>; driverData: Record<string, unknown> }>({
  dataType: () => "jsonb",
});

const idUuid = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const creadoEn = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const enLista = (columna: unknown, valores: readonly string[]) =>
  sql`${columna} in (${sql.raw(valores.map((v) => `'${v}'`).join(", "))})`;

// Cuentas que reciben SPEI. Con historial no se borran: se deshabilitan (`is_eligible = false`).
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: idUuid(),
    name: text("name").notNull(),
    bankName: text("bank_name").notNull(),
    accountHolder: text("account_holder").notNull(),
    clabe: text("clabe").notNull(),
    // Menor número = más prioridad.
    priority: integer("priority").notNull(),
    monthlyLimitCents: integer("monthly_limit_cents").notNull(),
    isEligible: boolean("is_eligible").notNull().default(true),
    createdAt: creadoEn(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [check("bank_accounts_monthly_limit_check", sql`${t.monthlyLimitCents} > 0`)],
);

// Importe completo de la reserva en una sola cuenta. Lo comprometido del mes es la suma de las
// `vigente` de la cuenta en ese `calendar_month` (fijado al crearla con AGENCY_TIMEZONE).
export const bankAllocations = pgTable(
  "bank_allocations",
  {
    id: idUuid(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    calendarMonth: text("calendar_month").notNull(),
    status: text("status", { enum: ESTADOS_ASIGNACION }).notNull().default("vigente"),
    // Instrucciones SPEI emitidas; inmutables aunque la cuenta cambie después.
    instructionSnapshot: jsonb("instruction_snapshot").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: creadoEn(),
  },
  (t) => [
    uniqueIndex("bank_allocations_booking_vigente_idx")
      .on(t.bookingId)
      .where(sql`${t.status} = 'vigente'`),
    index("bank_allocations_account_month_status_idx").on(
      t.bankAccountId,
      t.calendarMonth,
      t.status,
    ),
    check("bank_allocations_amount_check", sql`${t.amountCents} > 0`),
    check("bank_allocations_month_check", sql`${t.calendarMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("bank_allocations_status_check", enLista(t.status, ESTADOS_ASIGNACION)),
    check(
      "bank_allocations_released_check",
      sql`(${t.status} = 'liberada') = (${t.releasedAt} is not null)`,
    ),
  ],
);

// Lo que declara el comprador; no es ingreso hasta que un admin lo verifica. Un reemplazo apunta al
// reporte anterior (que pasa a `reemplazado`) y no crea ningún movimiento.
export const paymentReports = pgTable(
  "payment_reports",
  {
    id: idUuid(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    // Garantiza que todos los SPEI de la reserva usan la misma cuenta.
    bankAllocationId: uuid("bank_allocation_id")
      .notNull()
      .references(() => bankAllocations.id, { onDelete: "restrict" }),
    reportedAmountCents: integer("reported_amount_cents").notNull(),
    // Clave de rastreo o referencia SPEI que escribe el comprador; opcional, sin formato ni unicidad.
    trackingReference: text("tracking_reference"),
    // UUID de un intento de reporte: reintentar el MISMO envío no crea otro reporte. Nulo en los
    // reportes que no vienen de un envío del comprador (p. ej. los sembrados por otras issues).
    idempotencyKey: uuid("idempotency_key"),
    evidenceAssetId: uuid("evidence_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    status: text("status", { enum: ESTADOS_REPORTE }).notNull().default("pendiente"),
    replacesReportId: uuid("replaces_report_id")
      .references((): AnyPgColumn => paymentReports.id, { onDelete: "restrict" })
      .unique(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("payment_reports_booking_id_status_idx").on(t.bookingId, t.status),
    uniqueIndex("payment_reports_booking_key_idx").on(t.bookingId, t.idempotencyKey),
    check(
      "payment_reports_tracking_reference_check",
      sql`${t.trackingReference} is null or char_length(${t.trackingReference}) between 1 and 40`,
    ),
    check("payment_reports_amount_check", sql`${t.reportedAmountCents} > 0`),
    check("payment_reports_status_check", enLista(t.status, ESTADOS_REPORTE)),
  ],
);

// Un movimiento verificado es inmutable: una sola revisión por reporte, sin editar ni borrar.
export const paymentReviews = pgTable(
  "payment_reviews",
  {
    id: idUuid(),
    paymentReportId: uuid("payment_report_id")
      .notNull()
      .unique()
      .references(() => paymentReports.id, { onDelete: "restrict" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: text("decision", { enum: DECISIONES_REVISION }).notNull(),
    reason: text("reason"),
    // Puede diferir del reportado; que no supere el saldo lo comprueba el servicio.
    verifiedAmountCents: integer("verified_amount_cents"),
    createdAt: creadoEn(),
  },
  (t) => [
    check("payment_reviews_decision_check", enLista(t.decision, DECISIONES_REVISION)),
    check(
      "payment_reviews_amount_check",
      sql`(${t.decision} = 'verificado' and ${t.verifiedAmountCents} is not null and ${t.verifiedAmountCents} > 0)
        or (${t.decision} = 'rechazado' and ${t.verifiedAmountCents} is null)`,
    ),
  ],
);

// Cobro en efectivo registrado por un admin; no consume capacidad bancaria.
export const cashPayments = pgTable(
  "cash_payments",
  {
    id: idUuid(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    note: text("note"),
    createdAt: creadoEn(),
  },
  (t) => [
    index("cash_payments_booking_id_idx").on(t.bookingId),
    check("cash_payments_amount_check", sql`${t.amountCents} > 0`),
  ],
);

// Alertas y casos para resolución administrativa (sin cuenta elegible, cancelación con pago verificado).
export const adminCases = pgTable(
  "admin_cases",
  {
    id: idUuid(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    type: text("type", { enum: TIPOS_CASO }).notNull(),
    status: text("status", { enum: ESTADOS_CASO }).notNull().default("abierto"),
    note: text("note"),
    resolvedBy: uuid("resolved_by").references(() => user.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: creadoEn(),
  },
  (t) => [
    index("admin_cases_booking_id_idx").on(t.bookingId),
    check("admin_cases_type_check", enLista(t.type, TIPOS_CASO)),
    check("admin_cases_status_check", enLista(t.status, ESTADOS_CASO)),
    check(
      "admin_cases_resolved_check",
      sql`(${t.status} = 'resuelto') = (${t.resolvedAt} is not null)`,
    ),
    check("admin_cases_resolver_check", sql`(${t.resolvedAt} is null) = (${t.resolvedBy} is null)`),
  ],
);
