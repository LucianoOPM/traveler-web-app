import { AppError, ConflictError, NotFoundError } from "@lib/errors";
import { utcALocal } from "@lib/fechas";
import { formatoDeToken, hashDeToken } from "@modules/bookings/domain/access-token";
import { estadoEfectivo } from "@modules/bookings/domain/booking-rules";
import {
  admiteInstrucciones,
  construirSnapshot,
  decidirSolicitud,
  elegirCuenta,
  type InstruccionesSpei,
} from "../domain/allocation-rules";
import type { BankAllocationRepository } from "../domain/bank-allocation-repository";

const noEncontrada = () => new NotFoundError("Reserva no encontrada");

export type InstruccionesDePago = {
  instructions: InstruccionesSpei;
  /** Lo que aún falta por pagar; distinto del importe comprometido de la asignación. */
  pendingCents: number;
};

// Un rechazo de negocio se devuelve como valor y se lanza después del commit: así la alerta de «sin
// cuenta elegible» y la expiración materializada no se pierden con el rollback (como en H3).
type Veredicto<T> = { valor: T } | { error: AppError };

export class BankAllocationService {
  constructor(
    private readonly repo: BankAllocationRepository,
    /** `AGENCY_TIMEZONE`: fija el mes de la asignación. */
    private readonly zona: string,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  /**
   * Lectura (GET): las instrucciones congeladas, solo si la reserva aún admite pagar. No escribe:
   * no asigna, no materializa expiraciones ni crea alertas.
   */
  async find(token: string): Promise<InstruccionesDePago | null> {
    if (!formatoDeToken(token)) return null;
    const reserva = await this.repo.reservaPorToken(hashDeToken(token));
    if (!reserva || !admiteInstrucciones(estadoEfectivo(reserva, this.ahora()))) return null;
    const asignacion = await this.repo.asignacionVigente(reserva.id);
    if (!asignacion) return null;
    return {
      instructions: asignacion.instructionSnapshot as InstruccionesSpei,
      pendingCents: await this.repo.saldoPendiente(reserva.id),
    };
  }

  /**
   * Pide las instrucciones SPEI con el token de consulta. Idempotente: una asignación vigente por
   * reserva, por el importe completo y en una sola cuenta. Orden de bloqueos (ADR-029): la salida,
   * luego las cuentas por `id`; el comprometido se calcula con las cuentas bloqueadas.
   */
  async requestInstructions(token: string): Promise<InstruccionesDePago> {
    if (!formatoDeToken(token)) throw noEncontrada();
    const hash = hashDeToken(token);

    const resultado = await this.repo.transaction(
      async (tx): Promise<Veredicto<{ bookingId: string; instructions: InstruccionesSpei }>> => {
        const departureId = await tx.salidaPorToken(hash);
        if (!departureId || !(await tx.bloquearSalida(departureId))) {
          return { error: noEncontrada() };
        }
        const cuentas = await tx.bloquearCuentas(departureId);
        const ahora = this.ahora();
        await tx.expirarVencidas(departureId, ahora);
        // Con la salida bloqueada: si el enlace se regeneró mientras esperábamos, ya no existe.
        const reserva = await tx.reservaPorToken(hash);
        if (!reserva || reserva.departureId !== departureId) return { error: noEncontrada() };

        let decision;
        try {
          decision = decidirSolicitud(reserva.status);
        } catch (error) {
          if (error instanceof AppError) return { error };
          throw error;
        }
        const existente = await tx.asignacionVigente(reserva.id);
        if (existente) {
          return {
            valor: {
              bookingId: reserva.id,
              instructions: existente.instructionSnapshot as InstruccionesSpei,
            },
          };
        }
        if (decision === "solo_existente") {
          return { error: new ConflictError("La reserva no tiene instrucciones de pago vigentes") };
        }

        const mes = utcALocal(ahora, this.zona).slice(0, 7);
        const elegibles = cuentas.filter((c) => c.isEligible);
        const comprometido = await tx.comprometidoPorCuenta(
          elegibles.map((c) => c.id),
          mes,
        );
        const elegida = elegirCuenta(
          elegibles.map((c) => ({ ...c, committedCents: comprometido.get(c.id) ?? 0 })),
          reserva.totalCents,
        );

        if (!elegida) {
          // Un solo caso abierto por reserva: la salida bloqueada serializa las solicitudes.
          if (!(await tx.casoAbierto(reserva.id))) {
            const caseId = await tx.insertarCaso(reserva.id);
            await tx.audit({
              actorType: "sistema",
              action: "admin_case.opened",
              entityType: "admin_case",
              entityId: caseId,
              before: null,
              after: { type: "sin_cuenta_elegible", bookingId: reserva.id },
            });
          }
          return {
            error: new ConflictError(
              "No hay una cuenta disponible por ahora; la agencia se pondrá en contacto contigo",
              { code: "no_eligible_account" },
            ),
          };
        }

        const instructions = construirSnapshot(elegida, reserva, mes);
        const asignacion = await tx.insertarAsignacion({
          bookingId: reserva.id,
          bankAccountId: elegida.id,
          amountCents: reserva.totalCents,
          calendarMonth: mes,
          instructionSnapshot: instructions,
        });
        await tx.insertarEvento({
          bookingId: reserva.id,
          type: "cuenta_asignada",
          actorType: "comprador",
        });
        // Sin CLABE completa, titular ni token en la auditoría.
        await tx.audit({
          actorType: "comprador",
          action: "bank_allocation.created",
          entityType: "bank_allocation",
          entityId: asignacion.id,
          before: null,
          after: {
            bookingId: reserva.id,
            bankAccountId: elegida.id,
            amountCents: reserva.totalCents,
            calendarMonth: mes,
            clabeUltimos4: elegida.clabe.slice(-4),
          },
        });
        return { valor: { bookingId: reserva.id, instructions } };
      },
    );
    if ("error" in resultado) throw resultado.error;
    return {
      instructions: resultado.valor.instructions,
      pendingCents: await this.repo.saldoPendiente(resultado.valor.bookingId),
    };
  }

  /** Casos `sin_cuenta_elegible` abiertos, para `/admin/cuentas`. */
  alertas() {
    return this.repo.alertasAbiertas();
  }
}
