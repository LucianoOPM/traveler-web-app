import type { NewAuditEvent } from "@modules/audit/types";
import type { BookingStatus, NewBookingEvent } from "@modules/bookings/types";
import type { MediaAsset, NewMediaAsset } from "@modules/media/types";
import type { BankAllocation, PaymentReport } from "../types";
import type { ReservaParaAsignar } from "./bank-allocation-repository";

export type ReporteGuardado = Pick<
  PaymentReport,
  "id" | "status" | "submittedAt" | "trackingReference"
> & { amountCents: number; evidenceAssetId: string };

/** Lo que el comprador ve de sus reportes: sin ids de archivo ni enlaces. */
export type ReporteDeComprador = {
  submittedAt: Date;
  reportedAmountCents: number;
  verifiedAmountCents: number | null;
  status: PaymentReport["status"];
};

export interface PaymentReportTx {
  salidaPorToken(hash: string): Promise<string | null>;
  bloquearSalida(departureId: string): Promise<boolean>;
  expirarVencidas(departureId: string, ahora: Date): Promise<void>;
  reservaPorToken(hash: string): Promise<ReservaParaAsignar | null>;
  asignacionVigente(bookingId: string): Promise<BankAllocation | null>;
  /** Total − SPEI verificados − efectivo. Los comprobantes pendientes no restan. */
  saldoPendiente(bookingId: string): Promise<number>;
  reportePorClave(bookingId: string, clave: string): Promise<ReporteGuardado | null>;
  /** Fila de `media_assets` de una evidencia: dentro de la transacción del reporte. */
  insertarActivo(datos: NewMediaAsset): Promise<void>;
  insertarReporte(datos: {
    bookingId: string;
    bankAllocationId: string;
    reportedAmountCents: number;
    trackingReference: string | null;
    idempotencyKey: string;
    evidenceAssetId: string;
  }): Promise<PaymentReport>;
  /** Actualización condicional por estado; `false` si la reserva ya no estaba en `esperado`. */
  cambiarEstado(bookingId: string, esperado: BookingStatus, nuevo: BookingStatus): Promise<boolean>;
  insertarEvento(datos: NewBookingEvent): Promise<void>;
  audit(evento: NewAuditEvent): Promise<void>;
}

export interface PaymentReportRepository {
  transaction<T>(fn: (tx: PaymentReportTx) => Promise<T>): Promise<T>;
  /** Solo lectura. */
  reservaPorToken(hash: string): Promise<ReservaParaAsignar | null>;
  listar(bookingId: string): Promise<ReporteDeComprador[]>;
  /** El archivo solo si es la evidencia de algún reporte; `null` si no (p. ej. una portada). */
  evidencia(assetId: string): Promise<MediaAsset | null>;
}
