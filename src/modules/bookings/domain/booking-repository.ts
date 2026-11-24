import type { ActorLiberacion } from "@modules/payments/infrastructure/liberar-asignaciones";
import type { Departure, PackageStatus } from "@modules/catalog/types";
import type {
  Booking,
  BookingPassenger,
  BookingStatus,
  NewBooking,
  NewBookingEvent,
  NewBookingPassenger,
} from "../types";

export type SalidaBloqueada = Departure & { packageStatus: PackageStatus };

/** Operaciones sobre una transacción abierta. Sin reglas de negocio (ADR-026). */
export interface BookingTx {
  /** `SELECT … FOR UPDATE` de la salida (con el estado de su paquete); `null` si no existe. */
  bloquearSalida(id: string): Promise<SalidaBloqueada | null>;
  puntoAsignado(departureId: string, boardingPointId: string): Promise<boolean>;
  /** Reservas candidatas a retener (`pendiente`, `en_revision`, `parcial`, `pagada`) con su número de pasajeros. */
  reservasCandidatas(
    departureId: string,
  ): Promise<(Pick<Booking, "status" | "expiresAt"> & { pasajeros: number })[]>;
  /** `null` si la referencia o el hash ya existían (no inserta ni aborta la transacción). */
  insertarReserva(datos: NewBooking): Promise<Booking | null>;
  insertarPasajeros(datos: NewBookingPassenger[]): Promise<void>;
  insertarEvento(datos: NewBookingEvent): Promise<void>;
  /** Salida de la reserva, para bloquearla antes de tocar la reserva; `null` si no existe. */
  salidaDeReserva(bookingId: string): Promise<string | null>;
  buscarReserva(bookingId: string): Promise<(Booking & { pasajeros: number }) | null>;
  /** Actualización condicional por estado; `false` si la reserva ya no estaba en `esperado`. */
  cambiarReserva(
    bookingId: string,
    esperado: BookingStatus,
    cambios: Partial<Pick<NewBooking, "status" | "expiresAt" | "accessTokenHash">>,
  ): Promise<boolean>;
  /**
   * Libera la asignación bancaria de la reserva (salida ya bloqueada). Condicional e idempotente:
   * no hace nada sin asignación vigente o con comprobantes pendientes o un SPEI verificado.
   */
  liberarAsignacion(departureId: string, bookingId: string, actor: ActorLiberacion): Promise<void>;
  /** Materializa las pendientes vencidas de la salida (ya bloqueada) con su evento `sistema`. */
  expirarVencidas(departureId: string, ahora: Date): Promise<void>;
}

/** Lo que ve el comprador al consultar su reserva. Sin hash ni ids internos de otras tablas. */
export type ReservaConsultada = Pick<
  Booking,
  "reference" | "status" | "expiresAt" | "totalCents" | "buyerName"
> & {
  packageName: string;
  startsAt: Date;
  endsAt: Date;
  boardingPointName: string;
  passengers: Pick<BookingPassenger, "fullName" | "fareCategory" | "priceSnapshotCents">[];
};

/** Fila de la pantalla de administración: incluye el contacto completo (solo para admin). */
export type ReservaAdmin = Pick<
  Booking,
  | "id"
  | "reference"
  | "status"
  | "expiresAt"
  | "buyerName"
  | "buyerPhone"
  | "buyerEmail"
  | "totalCents"
> & { pasajeros: number; boardingPointName: string };

export type ListadoDeSalida = {
  salida: {
    id: string;
    packageId: string;
    packageName: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
  };
  reservas: ReservaAdmin[];
};

export interface BookingRepository {
  /** Solo lectura. `null` si la salida no existe. Más recientes primero. */
  listarPorSalida(departureId: string): Promise<ListadoDeSalida | null>;
  /** Solo lectura. `null` si ninguna reserva tiene ese hash. */
  findByTokenHash(hash: string): Promise<ReservaConsultada | null>;
  /** Ejecuta `fn` en una transacción; si lanza, se revierte todo. El servicio decide qué es atómico. */
  transaction<T>(fn: (tx: BookingTx) => Promise<T>): Promise<T>;
}
