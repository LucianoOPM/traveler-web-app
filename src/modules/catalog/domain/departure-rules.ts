// Reglas de dominio de la salida: funciones puras que lanzan `BusinessRuleError` (422).
// Los mensajes son públicos: no incluyen valores enviados por el cliente. Las mismas invariantes
// existen como CHECK en PostgreSQL (`departures_*_check`).
import { BusinessRuleError, ConflictError } from "@lib/errors";
import type { Departure, PackageStatus } from "../types";

export type DepartureContent = Pick<
  Departure,
  "startsAt" | "endsAt" | "capacity" | "adultPriceCents" | "childPriceCents" | "infantPriceCents"
>;

const enteroNoNegativo = (n: number) => Number.isInteger(n) && n >= 0;

/** Contenido completo y coherente. Las tarifas solo se etiquetan: no se validan edades (PEN-16). */
export function comprobarContenido(c: DepartureContent) {
  if (Number.isNaN(c.startsAt.getTime()) || Number.isNaN(c.endsAt.getTime())) {
    throw new BusinessRuleError("Las fechas de la salida no son válidas");
  }
  if (c.endsAt <= c.startsAt) {
    throw new BusinessRuleError("La salida debe terminar después de iniciar");
  }
  if (!enteroNoNegativo(c.capacity)) {
    throw new BusinessRuleError("La capacidad debe ser un entero no negativo");
  }
  if (![c.adultPriceCents, c.childPriceCents, c.infantPriceCents].every(enteroNoNegativo)) {
    throw new BusinessRuleError("Las tarifas deben ser enteros no negativos en centavos");
  }
}

/** Editar la salida o sus puntos de abordaje: solo borrador y publicada. */
export function comprobarModificable(salida: Departure) {
  if (salida.status === "cancelada") {
    throw new BusinessRuleError("Una salida cancelada no puede modificarse");
  }
}

export function comprobarPublicable(salida: Departure, estadoPaquete: PackageStatus) {
  if (salida.status !== "borrador") {
    throw new BusinessRuleError("Solo un borrador puede publicarse");
  }
  if (estadoPaquete !== "publicado") {
    throw new BusinessRuleError("El paquete de la salida debe estar publicado");
  }
}

export function comprobarCancelable(salida: Departure) {
  if (salida.status !== "publicada") {
    throw new BusinessRuleError("Solo una salida publicada puede cancelarse");
  }
}

export function comprobarEliminable(salida: Departure) {
  if (salida.status !== "borrador") {
    throw new BusinessRuleError("Solo un borrador puede eliminarse");
  }
}

/**
 * Con la salida bloqueada y `retenidos` calculado en la misma transacción (los pasajeros de
 * reservas que retienen inventario). Sin reservas activas no restringe nada. Las tarifas siempre
 * son editables: la reserva ya congeló su precio.
 */
export function comprobarEdicionConReservas(
  actual: Pick<Departure, "startsAt" | "endsAt" | "capacity">,
  cambios: Partial<DepartureContent> & { status?: Departure["status"] },
  retenidos: number,
) {
  if (retenidos === 0) return;
  const cambiaFecha = (nueva: Date | undefined, previa: Date) =>
    nueva !== undefined && nueva.getTime() !== previa.getTime();
  if (
    cambiaFecha(cambios.startsAt, actual.startsAt) ||
    cambiaFecha(cambios.endsAt, actual.endsAt)
  ) {
    throw new ConflictError("No se pueden cambiar las fechas de una salida con reservas activas");
  }
  if (cambios.status === "cancelada") {
    throw new ConflictError("No se puede cancelar una salida con reservas activas");
  }
  if (cambios.capacity !== undefined && cambios.capacity < retenidos) {
    throw new BusinessRuleError("La capacidad no puede ser menor que los lugares retenidos");
  }
}
