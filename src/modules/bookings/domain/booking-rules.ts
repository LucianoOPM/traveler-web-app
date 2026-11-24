import { BusinessRuleError, ConflictError } from "@lib/errors";
import type { Departure, PackageStatus } from "@modules/catalog/types";
import { CATEGORIAS_TARIFA } from "../schema";
import type { Booking, BookingStatus } from "../types";

/**
 * Única definición de «esta reserva ocupa lugares» (reserva, disponibilidad y reactivación la
 * reutilizan). Ocupa lugares todo pasajero de la reserva, infantes incluidos.
 * - `pendiente`: solo mientras `expiresAt > ahora`, aunque su estado aún no sea `expirada`.
 * - `en_revision`, `parcial` y `pagada` (ADR-029): siempre; no expiran, y `expiresAt` se ignora.
 * - `expirada` y `cancelada`: nunca.
 */
export function retieneInventario(
  reserva: Pick<Booking, "status" | "expiresAt">,
  ahora: Date,
): boolean {
  if (reserva.status === "pendiente") return reserva.expiresAt > ahora;
  return reserva.status !== "expirada" && reserva.status !== "cancelada";
}

// Reglas de la reserva nueva: funciones puras. Los mensajes son públicos (sin datos del cliente).
export const MAX_PASAJEROS = 10;

export type SolicitudReserva = {
  departureId: string;
  boardingPointId: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  passengers: { fullName: string; fareCategory: (typeof CATEGORIAS_TARIFA)[number] }[];
};

const vacio = (texto: unknown) => typeof texto !== "string" || texto.trim() === "";

/** Entre 1 y 10 pasajeros, categorías válidas y contacto completo. No valida edades (PEN-16). */
export function comprobarSolicitud(s: SolicitudReserva) {
  const n = s.passengers.length;
  if (n < 1 || n > MAX_PASAJEROS) {
    throw new BusinessRuleError(`Una reserva debe tener entre 1 y ${MAX_PASAJEROS} pasajeros`);
  }
  if (s.passengers.some((p) => vacio(p.fullName))) {
    throw new BusinessRuleError("Cada pasajero debe tener nombre");
  }
  if (s.passengers.some((p) => !CATEGORIAS_TARIFA.includes(p.fareCategory))) {
    throw new BusinessRuleError("La categoría de tarifa de un pasajero no es válida");
  }
  if (vacio(s.buyerName) || vacio(s.buyerPhone) || vacio(s.buyerEmail)) {
    throw new BusinessRuleError("El contacto debe incluir nombre, teléfono y correo");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.buyerEmail.trim())) {
    throw new BusinessRuleError("El correo de contacto no es válido");
  }
}

/** Salida publicada, de un paquete publicado y que aún no empieza. Se evalúa con la salida bloqueada. */
export function comprobarSalidaReservable(
  salida: Pick<Departure, "status" | "startsAt">,
  estadoPaquete: PackageStatus,
  ahora: Date,
) {
  if (salida.status !== "publicada" || estadoPaquete !== "publicado" || salida.startsAt <= ahora) {
    throw new BusinessRuleError("La salida no está disponible para reservar");
  }
}

const PRECIO = {
  adulto: "adultPriceCents",
  menor: "childPriceCents",
  infante: "infantPriceCents",
} as const;

/** Precio vigente de la salida para la categoría; la reserva lo congela en cada pasajero. */
export function precioPorCategoria(
  salida: Pick<Departure, (typeof PRECIO)[keyof typeof PRECIO]>,
  categoria: keyof typeof PRECIO,
): number {
  return salida[PRECIO[categoria]];
}

/** `min(ahora + horas, inicio de la salida)`: la retención nunca supera la salida. */
export function calcularExpiracion(ahora: Date, horas: number, startsAt: Date): Date {
  return new Date(Math.min(ahora.getTime() + horas * 3_600_000, startsAt.getTime()));
}

export function comprobarCapacidad(retenidos: number, nuevos: number, capacidad: number) {
  if (retenidos + nuevos > capacidad) {
    throw new ConflictError("No hay lugares suficientes en la salida", {
      code: "capacity_exceeded",
    });
  }
}

// Ciclo de vida de la reserva (#70). Reglas puras; el servicio las aplica con la salida bloqueada.
export const MAX_MOTIVO = 500;

/** El motivo de una acción administrativa: obligatorio (sin solo espacios) y de hasta 500 caracteres. */
export function comprobarMotivo(texto: string): string {
  const motivo = typeof texto === "string" ? texto.trim() : "";
  if (motivo === "") throw new BusinessRuleError("El motivo es obligatorio");
  if (motivo.length > MAX_MOTIVO) {
    throw new BusinessRuleError(`El motivo admite hasta ${MAX_MOTIVO} caracteres`);
  }
  return motivo;
}

/** Estado visible: una `pendiente` vencida es `expirada` aunque aún no se haya materializado. */
export const estadoEfectivo = (
  reserva: Pick<Booking, "status" | "expiresAt">,
  ahora: Date,
): BookingStatus =>
  reserva.status === "pendiente" && reserva.expiresAt <= ahora ? "expirada" : reserva.status;

/** Cancelar: desde cualquier estado vigente (con pagos también); repetida sobre `cancelada` es idempotente; `expirada` da 409. */
export function decidirCancelacion(
  reserva: Pick<Booking, "status" | "expiresAt">,
  ahora: Date,
): "cancelar" | "repetida" {
  const estado = estadoEfectivo(reserva, ahora);
  if (estado === "cancelada") return "repetida";
  if (estado === "expirada") {
    throw new ConflictError("Una reserva expirada no puede cancelarse; reactívala primero");
  }
  return "cancelar";
}

/** Reactivar: desde `expirada` o `cancelada`; en cualquier estado vigente es idempotente. */
export function decidirReactivacion(
  reserva: Pick<Booking, "status" | "expiresAt">,
  ahora: Date,
): "reactivar" | "repetida" {
  const estado = estadoEfectivo(reserva, ahora);
  return estado === "expirada" || estado === "cancelada" ? "reactivar" : "repetida";
}

/** Regenerar el enlace: solo reservas vigentes (las mismas que retienen inventario). */
export function comprobarTokenRegenerable(
  reserva: Pick<Booking, "status" | "expiresAt">,
  ahora: Date,
) {
  if (!retieneInventario(reserva, ahora)) {
    throw new ConflictError("Solo una reserva vigente puede regenerar su enlace");
  }
}

export type AccionDeReserva = "cancelar" | "reactivar" | "regenerar";

/** Acciones que la pantalla ofrece; coinciden con lo que las reglas anteriores aceptan. */
export function accionesPermitidas(
  reserva: Pick<Booking, "status" | "expiresAt">,
  ahora: Date,
): AccionDeReserva[] {
  const estado = estadoEfectivo(reserva, ahora);
  const acciones: AccionDeReserva[] = [];
  if (estado === "expirada" || estado === "cancelada") acciones.push("reactivar");
  else acciones.push("cancelar", "regenerar");
  return acciones;
}
