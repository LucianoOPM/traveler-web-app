import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { auditEvents } from "@modules/audit/schema";
import { expirarVencidas } from "@modules/bookings/infrastructure/reservas-retenidas";
import { bookingEvents, bookings } from "@modules/bookings/schema";
import { departures } from "@modules/catalog/schema";
import type {
  AlertaAdmin,
  BankAllocationRepository,
  BankAllocationTx,
} from "../domain/bank-allocation-repository";
import {
  adminCases,
  bankAccounts,
  bankAllocations,
  cashPayments,
  paymentReports,
  paymentReviews,
} from "../schema";
import { cuentasDeSalida } from "./liberar-asignaciones";

type Tx = Parameters<Parameters<BunSQLDatabase<typeof schema>["transaction"]>[0]>[0];
type Consulta = Pick<BunSQLDatabase<typeof schema>, "select">;

const columnasReserva = {
  id: bookings.id,
  reference: bookings.reference,
  status: bookings.status,
  expiresAt: bookings.expiresAt,
  totalCents: bookings.totalCents,
  departureId: bookings.departureId,
};

const reservaPorToken = async (q: Consulta, hash: string) => {
  const [fila] = await q
    .select(columnasReserva)
    .from(bookings)
    .where(eq(bookings.accessTokenHash, hash));
  return fila ?? null;
};

const asignacionVigente = async (q: Consulta, bookingId: string) => {
  const [fila] = await q
    .select()
    .from(bankAllocations)
    .where(and(eq(bankAllocations.bookingId, bookingId), eq(bankAllocations.status, "vigente")));
  return fila ?? null;
};

const operaciones = (tx: Tx): BankAllocationTx => ({
  async salidaPorToken(hash) {
    return (await reservaPorToken(tx, hash))?.departureId ?? null;
  },
  async bloquearSalida(departureId) {
    const filas = await tx
      .select({ id: departures.id })
      .from(departures)
      .where(eq(departures.id, departureId))
      .for("update");
    return filas.length > 0;
  },
  bloquearCuentas(departureId) {
    return tx
      .select()
      .from(bankAccounts)
      .where(
        or(
          eq(bankAccounts.isEligible, true),
          inArray(bankAccounts.id, cuentasDeSalida(tx, departureId)),
        ),
      )
      .orderBy(asc(bankAccounts.id))
      .for("update");
  },
  expirarVencidas: (departureId, ahora) => expirarVencidas(tx, departureId, ahora),
  reservaPorToken: (hash) => reservaPorToken(tx, hash),
  asignacionVigente: (bookingId) => asignacionVigente(tx, bookingId),
  async comprometidoPorCuenta(ids, mes) {
    const mapa = new Map<string, number>();
    if (ids.length === 0) return mapa;
    const filas = await tx
      .select({
        id: bankAllocations.bankAccountId,
        total: sql<number>`coalesce(sum(${bankAllocations.amountCents}), 0)::int`,
      })
      .from(bankAllocations)
      .where(
        and(
          inArray(bankAllocations.bankAccountId, ids),
          eq(bankAllocations.calendarMonth, mes),
          eq(bankAllocations.status, "vigente"),
        ),
      )
      .groupBy(bankAllocations.bankAccountId);
    for (const f of filas) mapa.set(f.id, f.total);
    return mapa;
  },
  async insertarAsignacion(datos) {
    const [fila] = await tx.insert(bankAllocations).values(datos).returning();
    return fila!;
  },
  async insertarEvento(datos) {
    await tx.insert(bookingEvents).values(datos);
  },
  async casoAbierto(bookingId) {
    const filas = await tx
      .select({ id: adminCases.id })
      .from(adminCases)
      .where(
        and(
          eq(adminCases.bookingId, bookingId),
          eq(adminCases.type, "sin_cuenta_elegible"),
          eq(adminCases.status, "abierto"),
        ),
      );
    return filas.length > 0;
  },
  async insertarCaso(bookingId) {
    const [fila] = await tx
      .insert(adminCases)
      .values({ bookingId, type: "sin_cuenta_elegible" })
      .returning({ id: adminCases.id });
    return fila!.id;
  },
  async audit(evento) {
    await tx.insert(auditEvents).values(evento);
  },
});

export class DrizzleBankAllocationRepository implements BankAllocationRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  transaction<T>(fn: (tx: BankAllocationTx) => Promise<T>) {
    return this.db.transaction((tx) => fn(operaciones(tx)));
  }

  reservaPorToken(hash: string) {
    return reservaPorToken(this.db, hash);
  }

  asignacionVigente(bookingId: string) {
    return asignacionVigente(this.db, bookingId);
  }

  async saldoPendiente(bookingId: string) {
    // SQL a mano con alias: con una sola tabla Drizzle omite el prefijo de columna y `id` sería ambiguo.
    const filas = await this.db.execute<{ saldo: number }>(sql`
      select b.total_cents
        - coalesce((select sum(v.verified_amount_cents)
            from ${paymentReviews} v join ${paymentReports} r on r.id = v.payment_report_id
            where r.booking_id = b.id and v.decision = 'verificado'), 0)
        - coalesce((select sum(c.amount_cents) from ${cashPayments} c
            where c.booking_id = b.id), 0) as saldo
      from ${bookings} b where b.id = ${bookingId}`);
    return Number(filas[0]?.saldo ?? 0);
  }

  async alertasAbiertas(): Promise<AlertaAdmin[]> {
    const conAsignacion = sql<boolean>`exists (select 1 from ${bankAllocations}
      where ${bankAllocations.bookingId} = ${bookings.id} and ${bankAllocations.status} = 'vigente')`;
    const filas = await this.db
      .select({
        caseId: adminCases.id,
        bookingId: bookings.id,
        departureId: bookings.departureId,
        reference: bookings.reference,
        status: bookings.status,
        expiresAt: bookings.expiresAt,
        totalCents: bookings.totalCents,
        createdAt: adminCases.createdAt,
        conAsignacion,
      })
      .from(adminCases)
      .innerJoin(bookings, eq(bookings.id, adminCases.bookingId))
      .where(and(eq(adminCases.type, "sin_cuenta_elegible"), eq(adminCases.status, "abierto")))
      .orderBy(desc(adminCases.createdAt));
    const ahora = new Date();
    return filas.map(({ expiresAt, conAsignacion: asignada, ...f }) => ({
      ...f,
      // Sigue vigente solo si la reserva aún puede pagar y no recibió cuenta.
      vigente:
        !asignada &&
        (f.status === "parcial" ||
          f.status === "en_revision" ||
          (f.status === "pendiente" && expiresAt > ahora)),
    }));
  }
}
