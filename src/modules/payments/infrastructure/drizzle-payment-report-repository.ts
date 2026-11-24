import { and, desc, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { auditEvents } from "@modules/audit/schema";
import { expirarVencidas } from "@modules/bookings/infrastructure/reservas-retenidas";
import { bookingEvents, bookings } from "@modules/bookings/schema";
import { mediaAssets } from "@modules/media/schema";
import type {
  PaymentReportRepository,
  PaymentReportTx,
  ReporteDeComprador,
} from "../domain/payment-report-repository";
import { paymentReports, paymentReviews } from "../schema";
import {
  asignacionVigente,
  bloquearSalidaDe,
  reservaPorToken,
  saldoPendienteDe,
} from "./drizzle-bank-allocation-repository";

type Tx = Parameters<Parameters<BunSQLDatabase<typeof schema>["transaction"]>[0]>[0];

const operaciones = (tx: Tx): PaymentReportTx => ({
  async salidaPorToken(hash) {
    return (await reservaPorToken(tx, hash))?.departureId ?? null;
  },
  bloquearSalida: (departureId) => bloquearSalidaDe(tx, departureId),
  expirarVencidas: (departureId, ahora) => expirarVencidas(tx, departureId, ahora),
  reservaPorToken: (hash) => reservaPorToken(tx, hash),
  asignacionVigente: (bookingId) => asignacionVigente(tx, bookingId),
  saldoPendiente: (bookingId) => saldoPendienteDe(tx, bookingId),
  async reportePorClave(bookingId, clave) {
    const [fila] = await tx
      .select({
        id: paymentReports.id,
        status: paymentReports.status,
        submittedAt: paymentReports.submittedAt,
        trackingReference: paymentReports.trackingReference,
        amountCents: paymentReports.reportedAmountCents,
        evidenceAssetId: paymentReports.evidenceAssetId,
      })
      .from(paymentReports)
      .where(
        and(eq(paymentReports.bookingId, bookingId), eq(paymentReports.idempotencyKey, clave)),
      );
    return fila ?? null;
  },
  async insertarActivo(datos) {
    await tx.insert(mediaAssets).values(datos);
  },
  async insertarReporte(datos) {
    const [fila] = await tx.insert(paymentReports).values(datos).returning();
    return fila!;
  },
  async cambiarEstado(bookingId, esperado, nuevo) {
    const filas = await tx
      .update(bookings)
      .set({ status: nuevo })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, esperado)))
      .returning({ id: bookings.id });
    return filas.length > 0;
  },
  async insertarEvento(datos) {
    await tx.insert(bookingEvents).values(datos);
  },
  async audit(evento) {
    await tx.insert(auditEvents).values(evento);
  },
});

export class DrizzlePaymentReportRepository implements PaymentReportRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  transaction<T>(fn: (tx: PaymentReportTx) => Promise<T>) {
    return this.db.transaction((tx) => fn(operaciones(tx)));
  }

  reservaPorToken(hash: string) {
    return reservaPorToken(this.db, hash);
  }

  async listar(bookingId: string): Promise<ReporteDeComprador[]> {
    return this.db
      .select({
        submittedAt: paymentReports.submittedAt,
        reportedAmountCents: paymentReports.reportedAmountCents,
        verifiedAmountCents: paymentReviews.verifiedAmountCents,
        status: paymentReports.status,
      })
      .from(paymentReports)
      .leftJoin(paymentReviews, eq(paymentReviews.paymentReportId, paymentReports.id))
      .where(eq(paymentReports.bookingId, bookingId))
      .orderBy(desc(paymentReports.submittedAt));
  }

  async evidencia(assetId: string) {
    const [fila] = await this.db
      .select({ asset: mediaAssets })
      .from(mediaAssets)
      .innerJoin(paymentReports, eq(paymentReports.evidenceAssetId, mediaAssets.id))
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    return fila?.asset ?? null;
  }
}
