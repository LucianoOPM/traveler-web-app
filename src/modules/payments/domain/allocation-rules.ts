import { ConflictError } from "@lib/errors";
import type { BankAccount, BankAllocation } from "../types";
import type { BookingStatus } from "@modules/bookings/types";

export type CuentaConCapacidad = Pick<BankAccount, "id" | "priority" | "monthlyLimitCents"> & {
  committedCents: number;
};

/**
 * Primera cuenta por prioridad (desempate por `id`) cuya capacidad del mes soporta el importe
 * COMPLETO; `null` si ninguna. Nunca divide el importe. `capacidad = límite − comprometido`.
 */
export function elegirCuenta<T extends CuentaConCapacidad>(
  cuentas: T[],
  importe: number,
): T | null {
  const ordenadas = [...cuentas].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  return ordenadas.find((c) => c.monthlyLimitCents - c.committedCents >= importe) ?? null;
}

/** Lo que el comprador recibe y lo que queda congelado en `instruction_snapshot`. */
export type InstruccionesSpei = {
  bankName: string;
  accountHolder: string;
  clabe: string;
  /** Concepto de la transferencia. */
  reference: string;
  /** Importe comprometido (total de la reserva); el saldo pendiente se calcula aparte. */
  amountCents: number;
  calendarMonth: string;
};

export function construirSnapshot(
  cuenta: Pick<BankAccount, "bankName" | "accountHolder" | "clabe">,
  reserva: { reference: string; totalCents: number },
  calendarMonth: string,
): InstruccionesSpei {
  return {
    bankName: cuenta.bankName,
    accountHolder: cuenta.accountHolder,
    clabe: cuenta.clabe,
    reference: reserva.reference,
    amountCents: reserva.totalCents,
    calendarMonth,
  };
}

/** Lo que se hace con una solicitud según el estado de la reserva (ADR-029). */
export type DecisionSolicitud = "asignar" | "solo_existente";

/**
 * `pendiente` (no vencida: la expiración ya se materializó) y `parcial` pueden pedir una asignación;
 * `en_revision` solo recupera la que ya tiene; `pagada`, `expirada` y `cancelada` no reciben
 * instrucciones.
 */
export function decidirSolicitud(estado: BookingStatus): DecisionSolicitud {
  if (estado === "pendiente" || estado === "parcial") return "asignar";
  if (estado === "en_revision") return "solo_existente";
  throw new ConflictError("La reserva no admite instrucciones de pago en su estado actual");
}

/** ¿La página debe ofrecer el botón o mostrar las instrucciones? Mismos estados que la Action. */
export const admiteInstrucciones = (estado: BookingStatus) =>
  estado === "pendiente" || estado === "parcial" || estado === "en_revision";

export type AsignacionConSnapshot = Pick<
  BankAllocation,
  "id" | "bankAccountId" | "calendarMonth"
> & {
  instructions: InstruccionesSpei;
};
