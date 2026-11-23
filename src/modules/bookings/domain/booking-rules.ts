import type { Booking } from "../types";

/**
 * Única definición de «esta reserva ocupa lugares» (reserva, disponibilidad y reactivación la
 * reutilizan). Ocupa lugares todo pasajero de la reserva, infantes incluidos.
 * - `pendiente`: solo mientras `expiresAt > ahora`, aunque su estado aún no sea `expirada`.
 * - `en_revision`: siempre; no expira, y `expiresAt` se ignora.
 * - `expirada` y `cancelada`: nunca.
 */
export function retieneInventario(
  reserva: Pick<Booking, "status" | "expiresAt">,
  ahora: Date,
): boolean {
  if (reserva.status === "en_revision") return true;
  return reserva.status === "pendiente" && reserva.expiresAt > ahora;
}
