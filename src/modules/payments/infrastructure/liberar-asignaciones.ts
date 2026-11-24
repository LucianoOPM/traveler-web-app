import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { auditEvents } from "@modules/audit/schema";
import { bookingEvents, bookings } from "@modules/bookings/schema";
import { bankAccounts, bankAllocations, paymentReports } from "../schema";

type Consulta = Pick<BunSQLDatabase<typeof schema>, "select" | "update" | "insert">;

/** Quién libera: el admin que cancela (con su motivo) o el sistema al materializar una expiración. */
export type ActorLiberacion =
  { tipo: "admin"; actorUserId: string; reason: string } | { tipo: "sistema" };

/** Cuentas con una asignación vigente en alguna reserva de la salida. */
export const cuentasDeSalida = (q: Pick<Consulta, "select">, departureId: string) =>
  q
    .select({ id: bankAllocations.bankAccountId })
    .from(bankAllocations)
    .innerJoin(bookings, eq(bookings.id, bankAllocations.bookingId))
    .where(and(eq(bookings.departureId, departureId), eq(bankAllocations.status, "vigente")));

/**
 * Protocolo de bloqueo de ADR-029 (la salida ya está bloqueada): todas las cuentas que la salida
 * puede liberar, en UNA sentencia ordenada por `id`. Así cualquier liberación posterior de la misma
 * transacción pide un subconjunto de lo ya retenido y nunca adquiere una cuenta fuera de orden.
 */
export const bloquearCuentasDeSalida = (q: Pick<Consulta, "select">, departureId: string) =>
  q
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(inArray(bankAccounts.id, cuentasDeSalida(q, departureId)))
    .orderBy(asc(bankAccounts.id))
    .for("update");

/**
 * Libera la asignación vigente de cada reserva (con la salida bloqueada). Condicional, idempotente y
 * auditada: no hace nada si no hay asignación vigente o si la reserva tiene un comprobante
 * pendiente o un SPEI verificado (tabla de reglas de ADR-029). No toca importe, mes ni snapshot.
 */
export async function liberarAsignaciones(
  q: Consulta,
  departureId: string,
  bookingIds: string[],
  actor: ActorLiberacion,
) {
  if (bookingIds.length === 0) return;
  const sinPagos = notExists(
    q
      .select({ uno: sql`1` })
      .from(paymentReports)
      .where(
        and(
          eq(paymentReports.bookingId, bankAllocations.bookingId),
          inArray(paymentReports.status, ["pendiente", "verificado"]),
        ),
      ),
  );
  const donde = and(
    inArray(bankAllocations.bookingId, bookingIds),
    eq(bankAllocations.status, "vigente"),
    sinPagos,
  );
  const candidatas = await q.select({ id: bankAllocations.id }).from(bankAllocations).where(donde);
  if (candidatas.length === 0) return;

  await bloquearCuentasDeSalida(q, departureId);
  // Se repite la condición con las cuentas bloqueadas: es la que decide.
  const liberadas = await q
    .update(bankAllocations)
    .set({ status: "liberada", releasedAt: sql`now()` })
    .where(donde)
    .returning({
      id: bankAllocations.id,
      bookingId: bankAllocations.bookingId,
      bankAccountId: bankAllocations.bankAccountId,
      amountCents: bankAllocations.amountCents,
      calendarMonth: bankAllocations.calendarMonth,
    });
  if (liberadas.length === 0) return;

  const quien =
    actor.tipo === "admin"
      ? { actorType: "admin" as const, actorUserId: actor.actorUserId }
      : { actorType: "sistema" as const };
  await q.insert(bookingEvents).values(
    liberadas.map((a) => ({
      bookingId: a.bookingId,
      type: "cuenta_liberada" as const,
      reason: actor.tipo === "admin" ? actor.reason : null,
      ...quien,
    })),
  );
  await q.insert(auditEvents).values(
    liberadas.map((a) => ({
      ...quien,
      action: "bank_allocation.released",
      entityType: "bank_allocation",
      entityId: a.id,
      before: { status: "vigente" },
      after: {
        status: "liberada",
        bookingId: a.bookingId,
        bankAccountId: a.bankAccountId,
        amountCents: a.amountCents,
        calendarMonth: a.calendarMonth,
      },
    })),
  );
}
