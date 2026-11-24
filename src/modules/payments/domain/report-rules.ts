import { createHash } from "node:crypto";
import { BusinessRuleError, ConflictError } from "@lib/errors";
import type { BookingStatus } from "@modules/bookings/types";

const MAX_CENTAVOS = 2_147_483_647; // `integer` de PostgreSQL
export const MAX_REFERENCIA = 40;

export type DatosReporte = {
  /** UUID del intento: reintentar el mismo envío con la misma clave no crea otro reporte. */
  requestKey: string;
  amountCents: number;
  trackingReference?: string | null;
};

/** Importe entero `> 0` y referencia recortada (vacía = `null`, máximo 40). Mensajes públicos y fijos. */
export function normalizarReporte(datos: DatosReporte) {
  if (
    !Number.isInteger(datos.amountCents) ||
    datos.amountCents <= 0 ||
    datos.amountCents > MAX_CENTAVOS
  ) {
    throw new BusinessRuleError("El importe reportado debe ser mayor que 0");
  }
  const referencia = (datos.trackingReference ?? "").trim();
  if (referencia.length > MAX_REFERENCIA) {
    throw new BusinessRuleError(`La referencia admite hasta ${MAX_REFERENCIA} caracteres`);
  }
  return {
    requestKey: datos.requestKey,
    amountCents: datos.amountCents,
    trackingReference: referencia === "" ? null : referencia,
  };
}

/** El saldo lo calcula el servicio dentro de la transacción: solo movimientos verificados (SPEI y efectivo). */
export function comprobarImporte(importe: number, saldoPendiente: number) {
  if (importe > saldoPendiente) {
    throw new BusinessRuleError("El importe reportado supera el saldo pendiente de la reserva");
  }
}

/** `pendiente` (ya sin vencer: la expiración se materializó antes), `parcial` y `en_revision` pueden reportar. */
export function puedeReportar(estado: BookingStatus) {
  return estado === "pendiente" || estado === "parcial" || estado === "en_revision";
}

export function comprobarEstadoParaReportar(estado: BookingStatus) {
  if (!puedeReportar(estado)) {
    throw new ConflictError("La reserva no admite reportar pagos en su estado actual");
  }
}

/** SHA-256 (hex) de los bytes de una evidencia. Solo se compara; nunca se guarda, registra ni audita. */
export const huellaDe = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Mismo importe y referencia que el reporte guardado con esa clave (la evidencia se compara aparte, por huella). */
export const mismosDatos = (
  guardado: { amountCents: number; trackingReference: string | null },
  nuevo: { amountCents: number; trackingReference: string | null },
) =>
  guardado.amountCents === nuevo.amountCents &&
  guardado.trackingReference === nuevo.trackingReference;
