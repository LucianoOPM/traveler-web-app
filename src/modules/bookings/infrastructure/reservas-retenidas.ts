import { and, count, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { retieneInventario } from "../domain/booking-rules";
import { bookingPassengers, bookings } from "../schema";

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
