import {
  AppError,
  BusinessRuleError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@lib/errors";
import {
  formatoDeToken,
  generarReferencia,
  generarToken,
  hashDeToken,
} from "../domain/access-token";
import {
  accionesPermitidas,
  calcularExpiracion,
  comprobarCapacidad,
  comprobarMotivo,
  comprobarSalidaReservable,
  comprobarSolicitud,
  comprobarTokenRegenerable,
  decidirCancelacion,
  decidirReactivacion,
  estadoEfectivo,
  precioPorCategoria,
  retieneInventario,
  type SolicitudReserva,
} from "../domain/booking-rules";
import type {
  BookingRepository,
  BookingTx,
  ReservaConsultada,
  SalidaBloqueada,
} from "../domain/booking-repository";
import type { Booking, BookingStatus } from "../types";

const INTENTOS_DE_REFERENCIA = 3;

export type OpcionesReservas = {
  /** `BOOKING_HOLD_HOURS`. */
  holdHours: number;
  ahora?: () => Date;
};

/** Quién y por qué: el actor sale de la sesión del servidor, nunca del cliente. */
export type AccionAdmin = { actorUserId: string; reason: string };

// Un rechazo de negocio (409/422) se devuelve como valor y no se lanza dentro de la transacción: así
// el commit conserva lo ya materializado (las expiraciones perezosas) y el rechazo se lanza después.
// Un error inesperado sí se lanza y revierte todo. Regla: antes de un rechazo solo puede haberse
// escrito la expiración; toda otra escritura va después de las comprobaciones.
type Veredicto<T> = { valor: T } | { error: AppError };

function probar<T>(comprobar: () => T): Veredicto<T> {
  try {
    return { valor: comprobar() };
  } catch (error) {
    if (error instanceof AppError) return { error };
    throw error;
  }
}

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
    return { ...reserva, status: estadoEfectivo(reserva, this.ahora()) };
  }

  /** Reservas de una salida para el administrador, con el estado visible y las acciones permitidas. Solo lectura. */
  async listByDeparture(departureId: string) {
    const listado = await this.repo.listarPorSalida(departureId);
    if (!listado) throw new NotFoundError("Salida no encontrada");
    const ahora = this.ahora();
    return {
      salida: listado.salida,
      reservas: listado.reservas.map((r) => ({
        ...r,
        status: estadoEfectivo(r, ahora),
        acciones: accionesPermitidas(r, ahora),
      })),
    };
  }

  /**
   * Crea la reserva en una sola transacción. La fila de la salida queda bloqueada hasta el commit:
   * es el único mecanismo que serializa reservas concurrentes sobre la misma salida. El `token`
   * se devuelve una sola vez; solo su hash se persiste.
   */
  async create(solicitud: SolicitudReserva): Promise<{ booking: Booking; token: string }> {
    comprobarSolicitud(solicitud);
    const nuevos = solicitud.passengers.length;

    return this.ejecutar(async (tx) => {
      const ahora = this.ahora();
      const salida = await tx.bloquearSalida(solicitud.departureId);
      if (!salida) {
        return { error: new BusinessRuleError("La salida no está disponible para reservar") };
      }
      await tx.expirarVencidas(salida.id, ahora);
      const noReservable = probar(() =>
        comprobarSalidaReservable(salida, salida.packageStatus, ahora),
      );
      if ("error" in noReservable) return noReservable;
      if (!(await tx.puntoAsignado(salida.id, solicitud.boardingPointId))) {
        return { error: new BusinessRuleError("El punto de abordaje no pertenece a la salida") };
      }
      const retenidos = await this.retenidos(tx, salida.id, ahora);
      const capacidad = probar(() => comprobarCapacidad(retenidos, nuevos, salida.capacity));
      if ("error" in capacidad) return capacidad;

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
        return { valor: { booking, token } };
      }
      throw new InternalError("No se pudo generar una referencia única para la reserva");
    });
  }

  /**
   * Cancela desde `pendiente` o `en_revision`. Repetida sobre una `cancelada`: éxito sin evento
   * nuevo. Desde `expirada`: 409.
   */
  async cancel(bookingId: string, { actorUserId, reason }: AccionAdmin) {
    const motivo = comprobarMotivo(reason);
    return this.sobreReserva(bookingId, async (tx, { reserva, ahora }) => {
      const decision = probar(() => decidirCancelacion(reserva, ahora));
      if ("error" in decision) return decision;
      if (decision.valor === "repetida") {
        return { valor: { status: reserva.status, cambio: false } };
      }
      await this.cambiar(tx, reserva, { status: "cancelada" });
      await tx.insertarEvento({
        bookingId,
        type: "cancelada",
        actorType: "admin",
        actorUserId,
        fromStatus: reserva.status,
        toStatus: "cancelada",
        reason: motivo,
      });
      return { valor: { status: "cancelada" as BookingStatus, cambio: true } };
    });
  }

  /**
   * Reactiva una `expirada` o `cancelada` solo si la salida sigue siendo reservable y caben sus
   * pasajeros (la capacidad se comprueba con la salida bloqueada). Repetida sobre una ya
   * `pendiente` o `en_revision`: éxito sin renovar el vencimiento ni crear evento.
   */
  async reactivate(bookingId: string, { actorUserId, reason }: AccionAdmin) {
    const motivo = comprobarMotivo(reason);
    return this.sobreReserva(bookingId, async (tx, { reserva, salida, ahora }) => {
      if (decidirReactivacion(reserva, ahora) === "repetida") {
        return {
          valor: { status: reserva.status, expiresAt: reserva.expiresAt, cambio: false },
        };
      }
      const noReservable = probar(() =>
        comprobarSalidaReservable(salida, salida.packageStatus, ahora),
      );
      if ("error" in noReservable) return noReservable;
      const retenidos = await this.retenidos(tx, salida.id, ahora);
      const capacidad = probar(() =>
        comprobarCapacidad(retenidos, reserva.pasajeros, salida.capacity),
      );
      if ("error" in capacidad) return capacidad;

      const expiresAt = calcularExpiracion(ahora, this.opciones.holdHours, salida.startsAt);
      await this.cambiar(tx, reserva, { status: "pendiente", expiresAt });
      await tx.insertarEvento({
        bookingId,
        type: "reactivada",
        actorType: "admin",
        actorUserId,
        fromStatus: reserva.status,
        toStatus: "pendiente",
        reason: motivo,
      });
      return { valor: { status: "pendiente" as BookingStatus, expiresAt, cambio: true } };
    });
  }

  /**
   * Reemplaza el token de una reserva vigente: el hash nuevo sustituye al anterior en la misma
   * operación, así que el enlace viejo deja de funcionar al instante. El token nuevo se devuelve
   * una sola vez; el evento no guarda token ni hash.
   */
  async regenerateToken(bookingId: string, { actorUserId, reason }: AccionAdmin) {
    const motivo = comprobarMotivo(reason);
    return this.sobreReserva(bookingId, async (tx, { reserva, ahora }) => {
      const vigente = probar(() => comprobarTokenRegenerable(reserva, ahora));
      if ("error" in vigente) return vigente;
      const token = generarToken();
      await this.cambiar(tx, reserva, { accessTokenHash: hashDeToken(token) });
      await tx.insertarEvento({
        bookingId,
        type: "token_regenerado",
        actorType: "admin",
        actorUserId,
        reason: motivo,
      });
      return { valor: { token } };
    });
  }

  private async ejecutar<T>(operar: (tx: BookingTx) => Promise<Veredicto<T>>): Promise<T> {
    const resultado = await this.repo.transaction(operar);
    if ("error" in resultado) throw resultado.error;
    return resultado.valor;
  }

  /**
   * Patrón común de las acciones sobre una reserva: bloquear la SALIDA (nunca la reserva sola),
   * materializar las vencidas y leer la reserva ya con el bloqueo. Así todo lo que toca las
   * reservas de una salida se serializa con la creación y con la edición de la salida.
   */
  private sobreReserva<T>(
    bookingId: string,
    operar: (
      tx: BookingTx,
      contexto: { reserva: Booking & { pasajeros: number }; salida: SalidaBloqueada; ahora: Date },
    ) => Promise<Veredicto<T>>,
  ): Promise<T> {
    return this.ejecutar(async (tx) => {
      const departureId = await tx.salidaDeReserva(bookingId);
      const salida = departureId ? await tx.bloquearSalida(departureId) : null;
      if (!salida) throw new NotFoundError("Reserva no encontrada");
      const ahora = this.ahora();
      await tx.expirarVencidas(salida.id, ahora);
      const reserva = await tx.buscarReserva(bookingId);
      if (!reserva) throw new NotFoundError("Reserva no encontrada");
      return operar(tx, { reserva, salida, ahora });
    });
  }

  // Pasajeros que ocupan lugar según la regla única `retieneInventario` (infantes incluidos).
  private async retenidos(tx: BookingTx, departureId: string, ahora: Date) {
    return (await tx.reservasCandidatas(departureId))
      .filter((r) => retieneInventario(r, ahora))
      .reduce((suma, r) => suma + r.pasajeros, 0);
  }

  // Bajo el bloqueo de la salida el estado no puede cambiar; si cambió (escritura fuera del
  // servicio), se revierte todo en lugar de pisar el cambio.
  private async cambiar(
    tx: BookingTx,
    reserva: Booking,
    cambios: Parameters<BookingTx["cambiarReserva"]>[2],
  ) {
    if (!(await tx.cambiarReserva(reserva.id, reserva.status, cambios))) {
      throw new ConflictError(
        "La reserva cambió mientras se procesaba la operación; inténtalo de nuevo",
      );
    }
  }
}
