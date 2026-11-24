import { AppError, ConflictError, NotFoundError } from "@lib/errors";
import { formatoDeToken, hashDeToken } from "@modules/bookings/domain/access-token";
import type { MediaService } from "@modules/media/application/media-service";
import {
  comprobarEstadoParaReportar,
  comprobarImporte,
  huellaDe,
  mismosDatos,
  normalizarReporte,
  type DatosReporte,
} from "../domain/report-rules";
import type {
  PaymentReportRepository,
  ReporteDeComprador,
} from "../domain/payment-report-repository";
import type { PaymentReport } from "../types";

const noEncontrada = () => new NotFoundError("Reserva no encontrada");

export type ReporteRegistrado = {
  amountCents: number;
  status: PaymentReport["status"];
  submittedAt: Date;
  /** Lo que sigue pendiente de pago: un reporte no lo cambia hasta que un admin verifica. */
  pendingCents: number;
};

// Un rechazo de negocio se devuelve como valor y se lanza tras el commit (patrón de H3 y #84): así
// las expiraciones materializadas bajo el bloqueo de la salida no se pierden con el rollback.
type Veredicto<T> = { valor: T } | { error: AppError };

export class PaymentReportService {
  constructor(
    private readonly repo: PaymentReportRepository,
    private readonly media: Pick<MediaService, "almacenarEvidencia" | "descartar" | "abrir">,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  /**
   * Reporta un pago SPEI con el token de consulta. NO suma ingresos, no liquida ni cambia lo
   * comprometido: deja un reporte `pendiente` y la reserva en `en_revision` (retiene y no expira,
   * sin tocar `expires_at`). Orden: validar el archivo, escribirlo, y una transacción con la salida
   * bloqueada que revalida token, estado, asignación y saldo e inserta TODAS las filas (activo,
   * reporte, estado, evento y auditoría). Si la operación no prospera, el archivo se borra.
   * Reintentar con la misma `requestKey` devuelve el reporte ya creado sin otro archivo ni evento.
   */
  async report(token: string, datos: DatosReporte, bytes: Uint8Array): Promise<ReporteRegistrado> {
    if (!formatoDeToken(token)) throw noEncontrada();
    const hash = hashDeToken(token);
    const nuevo = normalizarReporte(datos);
    // Sin escribir nada en disco para un token desconocido.
    if (!(await this.repo.reservaPorToken(hash))) throw noEncontrada();
    const archivo = await this.media.almacenarEvidencia(bytes);

    let creado = false;
    try {
      const resultado = await this.repo.transaction(
        async (tx): Promise<Veredicto<ReporteRegistrado>> => {
          const departureId = await tx.salidaPorToken(hash);
          if (!departureId || !(await tx.bloquearSalida(departureId))) {
            return { error: noEncontrada() };
          }
          await tx.expirarVencidas(departureId, this.ahora());
          // Con la salida bloqueada: si el enlace se regeneró mientras esperábamos, ya no existe.
          const reserva = await tx.reservaPorToken(hash);
          if (!reserva || reserva.departureId !== departureId) return { error: noEncontrada() };

          // Un reintento del mismo envío se resuelve antes que el estado: el reporte ya existe.
          const previo = await tx.reportePorClave(reserva.id, nuevo.requestKey);
          if (previo) {
            // Misma clave: solo es el mismo envío si importe, referencia y CONTENIDO de la evidencia
            // coinciden. El archivo original se lee (y se compara su SHA-256) únicamente en un reintento.
            const igual =
              mismosDatos(previo, nuevo) &&
              (await this.mismaEvidencia(previo.evidenceAssetId, bytes));
            if (!igual) {
              return {
                error: new ConflictError("La clave del envío ya se usó con otros datos", {
                  code: "idempotency_key_reused",
                }),
              };
            }
            return {
              valor: {
                amountCents: previo.amountCents,
                status: previo.status,
                submittedAt: previo.submittedAt,
                pendingCents: await tx.saldoPendiente(reserva.id),
              },
            };
          }

          try {
            comprobarEstadoParaReportar(reserva.status);
          } catch (error) {
            if (error instanceof AppError) return { error };
            throw error;
          }
          const asignacion = await tx.asignacionVigente(reserva.id);
          if (!asignacion) {
            return {
              error: new ConflictError("Pide primero las instrucciones de pago", {
                code: "no_allocation",
              }),
            };
          }
          const saldo = await tx.saldoPendiente(reserva.id);
          try {
            comprobarImporte(nuevo.amountCents, saldo);
          } catch (error) {
            if (error instanceof AppError) return { error };
            throw error;
          }

          await tx.insertarActivo({
            id: archivo.id,
            storageKey: archivo.storageKey,
            contentType: archivo.contentType,
            sizeBytes: archivo.sizeBytes,
          });
          const reporte = await tx.insertarReporte({
            bookingId: reserva.id,
            bankAllocationId: asignacion.id,
            reportedAmountCents: nuevo.amountCents,
            trackingReference: nuevo.trackingReference,
            idempotencyKey: nuevo.requestKey,
            evidenceAssetId: archivo.id,
          });
          if (reserva.status !== "en_revision") {
            // Bajo el bloqueo de la salida el estado no puede cambiar; si cambió, se revierte todo.
            if (!(await tx.cambiarEstado(reserva.id, reserva.status, "en_revision"))) {
              throw new ConflictError("La reserva cambió mientras se procesaba el reporte");
            }
          }
          await tx.insertarEvento({
            bookingId: reserva.id,
            type: "pago_reportado",
            actorType: "comprador",
            fromStatus: reserva.status,
            toStatus: "en_revision",
          });
          // Solo campos permitidos: sin token, referencia SPEI, ruta ni contenido de la evidencia.
          await tx.audit({
            actorType: "comprador",
            action: "payment_report.created",
            entityType: "payment_report",
            entityId: reporte.id,
            before: null,
            after: {
              bookingId: reserva.id,
              bankAllocationId: asignacion.id,
              reportedAmountCents: nuevo.amountCents,
              hasTrackingReference: nuevo.trackingReference !== null,
              evidenceType: archivo.contentType,
            },
          });
          creado = true;
          return {
            valor: {
              amountCents: reporte.reportedAmountCents,
              status: reporte.status,
              submittedAt: reporte.submittedAt,
              pendingCents: saldo,
            },
          };
        },
      );
      if ("error" in resultado) throw resultado.error;
      return resultado.valor;
    } finally {
      // Rechazo, reintento o fallo: el archivo solo se conserva si el reporte se creó.
      if (!creado) await this.media.descartar(archivo.storageKey).catch(() => {});
    }
  }

  /** `true` si la evidencia ya guardada tiene exactamente los mismos bytes; un archivo ilegible cuenta como distinto. */
  private async mismaEvidencia(assetId: string, bytes: Uint8Array) {
    try {
      const { bytes: guardados } = await this.media.abrir(assetId);
      return huellaDe(guardados) === huellaDe(bytes);
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
  }

  /** Lectura (GET): los reportes de la reserva del token, sin ids de archivo. No escribe. */
  async list(token: string): Promise<ReporteDeComprador[]> {
    if (!formatoDeToken(token)) return [];
    const reserva = await this.repo.reservaPorToken(hashDeToken(token));
    return reserva ? this.repo.listar(reserva.id) : [];
  }

  /** Evidencia para el admin: solo si el archivo es la evidencia de un reporte (nunca una portada). */
  async evidence(assetId: string) {
    const asset = await this.repo.evidencia(assetId);
    if (!asset) throw new NotFoundError("Recurso no encontrado");
    return this.media.abrir(asset.id);
  }
}
