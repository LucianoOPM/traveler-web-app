import type { Departure, PackageStatus } from "@modules/catalog/types";
import type { Booking, NewBooking, NewBookingEvent, NewBookingPassenger } from "../types";

export type SalidaBloqueada = Departure & { packageStatus: PackageStatus };

/** Operaciones sobre una transacción abierta. Sin reglas de negocio (ADR-026). */
export interface BookingTx {
  /** `SELECT … FOR UPDATE` de la salida (con el estado de su paquete); `null` si no existe. */
  bloquearSalida(id: string): Promise<SalidaBloqueada | null>;
  puntoAsignado(departureId: string, boardingPointId: string): Promise<boolean>;
  /** Reservas `pendiente` y `en_revision` de la salida con su número de pasajeros. */
  reservasCandidatas(
    departureId: string,
  ): Promise<(Pick<Booking, "status" | "expiresAt"> & { pasajeros: number })[]>;
  /** `null` si la referencia o el hash ya existían (no inserta ni aborta la transacción). */
  insertarReserva(datos: NewBooking): Promise<Booking | null>;
  insertarPasajeros(datos: NewBookingPassenger[]): Promise<void>;
  insertarEvento(datos: NewBookingEvent): Promise<void>;
}

export interface BookingRepository {
  /** Ejecuta `fn` en una transacción; si lanza, se revierte todo. El servicio decide qué es atómico. */
  transaction<T>(fn: (tx: BookingTx) => Promise<T>): Promise<T>;
}
