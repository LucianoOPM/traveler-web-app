import { BusinessRuleError, InternalError } from "@lib/errors";
import {
  formatoDeToken,
  generarReferencia,
  generarToken,
  hashDeToken,
} from "../domain/access-token";
import {
  calcularExpiracion,
  comprobarCapacidad,
  comprobarSalidaReservable,
  comprobarSolicitud,
  precioPorCategoria,
  retieneInventario,
  type SolicitudReserva,
} from "../domain/booking-rules";
import type { BookingRepository, ReservaConsultada } from "../domain/booking-repository";
import type { Booking } from "../types";

const INTENTOS_DE_REFERENCIA = 3;

export type OpcionesReservas = {
  /** `BOOKING_HOLD_HOURS`. */
  holdHours: number;
  ahora?: () => Date;
};

export class BookingService {
  private readonly ahora: () => Date;

  constructor(
    private readonly repo: BookingRepository,
    private readonly opciones: OpcionesReservas,
  ) {
    this.ahora = opciones.ahora ?? (() => new Date());
  }

  /**
   * Consulta de solo lectura por token. `null` si el token es inválido o no existe (no se distinguen).
   * No materializa la expiración: una `pendiente` vencida se muestra como `expirada` sin escribir.
   */
  async findByToken(token: string): Promise<ReservaConsultada | null> {
    if (!formatoDeToken(token)) return null;
    const reserva = await this.repo.findByTokenHash(hashDeToken(token));
    if (!reserva) return null;
    const vencida = reserva.status === "pendiente" && reserva.expiresAt <= this.ahora();
    return vencida ? { ...reserva, status: "expirada" } : reserva;
  }

  /**
   * Crea la reserva en una sola transacción. La fila de la salida queda bloqueada hasta el commit:
   * es el único mecanismo que serializa reservas concurrentes sobre la misma salida. El `token`
   * se devuelve una sola vez; solo su hash se persiste.
   */
  async create(solicitud: SolicitudReserva): Promise<{ booking: Booking; token: string }> {
    comprobarSolicitud(solicitud);
    const nuevos = solicitud.passengers.length;

    return this.repo.transaction(async (tx) => {
      const ahora = this.ahora();
      const salida = await tx.bloquearSalida(solicitud.departureId);
      if (!salida) throw new BusinessRuleError("La salida no está disponible para reservar");
      comprobarSalidaReservable(salida, salida.packageStatus, ahora);
      if (!(await tx.puntoAsignado(salida.id, solicitud.boardingPointId))) {
        throw new BusinessRuleError("El punto de abordaje no pertenece a la salida");
      }

      const retenidos = (await tx.reservasCandidatas(salida.id))
        .filter((r) => retieneInventario(r, ahora))
        .reduce((suma, r) => suma + r.pasajeros, 0);
      comprobarCapacidad(retenidos, nuevos, salida.capacity);

      const precios = solicitud.passengers.map((p) => precioPorCategoria(salida, p.fareCategory));
      const datos = {
        departureId: salida.id,
        boardingPointId: solicitud.boardingPointId,
        buyerName: solicitud.buyerName.trim(),
        buyerPhone: solicitud.buyerPhone.trim(),
        buyerEmail: solicitud.buyerEmail.trim(),
        status: "pendiente" as const,
        expiresAt: calcularExpiracion(ahora, this.opciones.holdHours, salida.startsAt),
        totalCents: precios.reduce((suma, precio) => suma + precio, 0),
      };

      // El insert no aborta la transacción ante una colisión: se reintenta con otra referencia.
      for (let intento = 0; intento < INTENTOS_DE_REFERENCIA; intento++) {
        const token = generarToken();
        const booking = await tx.insertarReserva({
          ...datos,
          reference: generarReferencia(),
          accessTokenHash: hashDeToken(token),
        });
        if (!booking) continue;
        await tx.insertarPasajeros(
          solicitud.passengers.map((p, i) => ({
            bookingId: booking.id,
            fullName: p.fullName.trim(),
            fareCategory: p.fareCategory,
            priceSnapshotCents: precios[i]!,
          })),
        );
        await tx.insertarEvento({
          bookingId: booking.id,
          type: "creada",
          actorType: "comprador",
          toStatus: "pendiente",
        });
        return { booking, token };
      }
      throw new InternalError("No se pudo generar una referencia única para la reserva");
    });
  }
}
