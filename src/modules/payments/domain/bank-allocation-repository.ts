import type { NewAuditEvent } from "@modules/audit/types";
import type { Booking, NewBookingEvent } from "@modules/bookings/types";
import type { BankAccount, BankAllocation } from "../types";
import type { InstruccionesSpei } from "./allocation-rules";

export type ReservaParaAsignar = Pick<
  Booking,
  "id" | "reference" | "status" | "expiresAt" | "totalCents" | "departureId"
>;

export type AlertaAdmin = {
  caseId: string;
  bookingId: string;
  departureId: string;
  reference: string;
  status: Booking["status"];
  totalCents: number;
  createdAt: Date;
  /** `true` si la reserva sigue vigente y sin cuenta: requiere intervención. Si no, solo cierre administrativo. */
  vigente: boolean;
};

export interface BankAllocationTx {
  /** Salida de la reserva con ese hash de token; `null` si no existe. Lectura sin bloqueo. */
  salidaPorToken(hash: string): Promise<string | null>;
  /** `SELECT … FOR UPDATE` de la salida (el mismo bloqueo que usa H3). */
  bloquearSalida(departureId: string): Promise<boolean>;
  /**
   * Cuentas elegibles más las que la salida puede liberar, UNA sentencia ordenada por `id` y
   * `FOR UPDATE`. Es el único sitio donde el asignador adquiere cuentas (ADR-029).
   */
  bloquearCuentas(departureId: string): Promise<BankAccount[]>;
  expirarVencidas(departureId: string, ahora: Date): Promise<void>;
  /** Reserva por hash de token, leída con la salida bloqueada: detecta un token regenerado. */
  reservaPorToken(hash: string): Promise<ReservaParaAsignar | null>;
  asignacionVigente(bookingId: string): Promise<BankAllocation | null>;
  /** Suma de asignaciones `vigente` por cuenta en el mes `YYYY-MM`. */
  comprometidoPorCuenta(ids: string[], mes: string): Promise<Map<string, number>>;
  insertarAsignacion(datos: {
    bookingId: string;
    bankAccountId: string;
    amountCents: number;
    calendarMonth: string;
    instructionSnapshot: InstruccionesSpei;
  }): Promise<BankAllocation>;
  insertarEvento(datos: NewBookingEvent): Promise<void>;
  casoAbierto(bookingId: string): Promise<boolean>;
  insertarCaso(bookingId: string): Promise<string>;
  audit(evento: NewAuditEvent): Promise<void>;
}

export interface BankAllocationRepository {
  transaction<T>(fn: (tx: BankAllocationTx) => Promise<T>): Promise<T>;
  /** Solo lectura. */
  reservaPorToken(hash: string): Promise<ReservaParaAsignar | null>;
  asignacionVigente(bookingId: string): Promise<BankAllocation | null>;
  /** Total de la reserva menos SPEI verificados y efectivo registrado. */
  saldoPendiente(bookingId: string): Promise<number>;
  /** Casos `sin_cuenta_elegible` abiertos, más recientes primero. */
  alertasAbiertas(): Promise<AlertaAdmin[]>;
}
