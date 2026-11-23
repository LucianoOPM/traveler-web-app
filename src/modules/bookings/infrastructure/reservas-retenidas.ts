import { and, count, eq, inArray, lte } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { retieneInventario } from "../domain/booking-rules";
import { bookingEvents, bookingPassengers, bookings } from "../schema";

// Acepta la base o una transacción: dentro de una, ve las escrituras y los bloqueos de esa transacción.
type Consulta = Pick<BunSQLDatabase<typeof schema>, "select">;

/** Reservas `pendiente` y `en_revision` de la salida con su número de pasajeros. */
export function reservasCandidatas(q: Consulta, departureId: string) {
  return q
    .select({
      status: bookings.status,
      expiresAt: bookings.expiresAt,
      pasajeros: count(bookingPassengers.id),
    })
    .from(bookings)
    .leftJoin(bookingPassengers, eq(bookingPassengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.departureId, departureId),
        inArray(bookings.status, ["pendiente", "en_revision"]),
      ),
    )
    .groupBy(bookings.id);
}

/** Pasajeros que ocupan lugar, con la regla única `retieneInventario` (infantes incluidos). */
export async function pasajerosRetenidos(q: Consulta, departureId: string, ahora: Date) {
  return (await reservasCandidatas(q, departureId))
    .filter((r) => retieneInventario(r, ahora))
    .reduce((suma, r) => suma + r.pasajeros, 0);
}

/**
 * Expiración perezosa: materializa como `expirada` las `pendiente` vencidas de la salida y deja el
 * evento `expirada` (actor `sistema`). Se llama con la salida bloqueada, dentro de la transacción
 * de quien la bloquea. Es la misma condición que `retieneInventario` (`expires_at <= ahora`), así
 * que no cambia el inventario retenido. `en_revision` nunca expira.
 */
export async function expirarVencidas(
  q: Pick<BunSQLDatabase<typeof schema>, "update" | "insert">,
  departureId: string,
  ahora: Date,
) {
  const vencidas = await q
    .update(bookings)
    .set({ status: "expirada" })
    .where(
      and(
        eq(bookings.departureId, departureId),
        eq(bookings.status, "pendiente"),
        lte(bookings.expiresAt, ahora),
      ),
    )
    .returning({ id: bookings.id });
  if (vencidas.length === 0) return;
  await q.insert(bookingEvents).values(
    vencidas.map((v) => ({
      bookingId: v.id,
      type: "expirada" as const,
      actorType: "sistema" as const,
      fromStatus: "pendiente" as const,
      toStatus: "expirada" as const,
    })),
  );
}
