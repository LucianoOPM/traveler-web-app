import { describe, expect, test } from "bun:test";
import { BookingService } from "@modules/bookings/application/booking-service";
import { hashDeToken } from "@modules/bookings/domain/access-token";
import type {
  BookingRepository,
  BookingTx,
  SalidaBloqueada,
} from "@modules/bookings/domain/booking-repository";
import type { SolicitudReserva } from "@modules/bookings/domain/booking-rules";
import type { Booking, NewBooking } from "@modules/bookings/types";
import { BusinessRuleError, ConflictError, InternalError } from "@lib/errors";

const AHORA = new Date("2027-01-01T00:00:00Z");
const SALIDA = "5f1c1c0e-0000-4000-8000-000000000001";
const PUNTO = "5f1c1c0e-0000-4000-8000-0000000000b1";

const salidaBase: SalidaBloqueada = {
  id: SALIDA,
  packageId: "p",
  startsAt: new Date("2027-02-01T00:00:00Z"),
  endsAt: new Date("2027-02-03T00:00:00Z"),
  capacity: 4,
  adultPriceCents: 150000,
  childPriceCents: 100000,
  infantPriceCents: 0,
  status: "publicada",
  createdAt: AHORA,
  updatedAt: AHORA,
  packageStatus: "publicado",
};

const solicitud = (pasajeros: SolicitudReserva["passengers"]): SolicitudReserva => ({
  departureId: SALIDA,
  boardingPointId: PUNTO,
  buyerName: "Ana",
  buyerPhone: "5555555555",
  buyerEmail: "ana@example.com",
  passengers: pasajeros,
});
const adulto = { fullName: "Ana", fareCategory: "adulto" as const };

// Repositorio en memoria: `colisiones` fuerza que los primeros inserts de reserva devuelvan `null`.
function crear(
  opciones: {
    salida?: Partial<SalidaBloqueada> | null;
    puntos?: string[];
    candidatas?: Awaited<ReturnType<BookingTx["reservasCandidatas"]>>;
    colisiones?: number;
  } = {},
) {
  const escrituras: { reservas: NewBooking[]; pasajeros: unknown[]; eventos: unknown[] } = {
    reservas: [],
    pasajeros: [],
    eventos: [],
  };
  let colisiones = opciones.colisiones ?? 0;
  const salida = opciones.salida === null ? null : { ...salidaBase, ...opciones.salida };
  const tx: BookingTx = {
    bloquearSalida: async () => salida,
    puntoAsignado: async (_d, p) => (opciones.puntos ?? [PUNTO]).includes(p),
    reservasCandidatas: async () => opciones.candidatas ?? [],
    insertarReserva: async (datos) => {
      if (colisiones-- > 0) return null;
      escrituras.reservas.push(datos);
      return { id: "b1", createdAt: AHORA, updatedAt: AHORA, ...datos } as Booking;
    },
    insertarPasajeros: async (d) => void escrituras.pasajeros.push(...d),
    insertarEvento: async (e) => void escrituras.eventos.push(e),
  };
  const repo: BookingRepository = { transaction: (fn) => fn(tx) };
  const servicio = new BookingService(repo, { holdHours: 24, ahora: () => AHORA });
  return { servicio, escrituras };
}

describe("BookingService.create", () => {
  test("crea reserva, pasajeros con precio congelado y evento creada del comprador", async () => {
    const { servicio, escrituras } = crear();
    const { booking, token } = await servicio.create(
      solicitud([
        adulto,
        { fullName: "Luis", fareCategory: "menor" },
        { fullName: "Bebé", fareCategory: "infante" },
      ]),
    );
    expect(booking.totalCents).toBe(250000);
    expect(escrituras.pasajeros).toEqual([
      expect.objectContaining({ bookingId: "b1", priceSnapshotCents: 150000 }),
      expect.objectContaining({ priceSnapshotCents: 100000 }),
      expect.objectContaining({ fareCategory: "infante", priceSnapshotCents: 0 }),
    ]);
    expect(escrituras.eventos).toEqual([
      { bookingId: "b1", type: "creada", actorType: "comprador", toStatus: "pendiente" },
    ]);
    expect(booking.reference).toMatch(/^TT-/);
    expect(booking.status).toBe("pendiente");
    expect(booking.expiresAt).toEqual(new Date("2027-01-02T00:00:00Z"));
    // Solo el hash se persiste; el token no aparece en ninguna escritura.
    expect(booking.accessTokenHash).toBe(hashDeToken(token));
    expect(JSON.stringify(escrituras)).not.toContain(token);
  });

  test("expires_at no supera starts_at", async () => {
    const { servicio } = crear({ salida: { startsAt: new Date("2027-01-01T05:00:00Z") } });
    const { booking } = await servicio.create(solicitud([adulto]));
    expect(booking.expiresAt).toEqual(new Date("2027-01-01T05:00:00Z"));
  });

  test("los infantes ocupan lugar: 4 retenidos + 1 infante en capacidad 4 → 409", async () => {
    const { servicio, escrituras } = crear({
      candidatas: [
        { status: "pendiente", expiresAt: new Date("2027-01-02T00:00:00Z"), pasajeros: 4 },
      ],
    });
    const error = await servicio
      .create(solicitud([{ fullName: "Bebé", fareCategory: "infante" }]))
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("capacity_exceeded");
    expect(escrituras.reservas).toHaveLength(0);
  });

  test("cuentan en_revision y pendientes vigentes; no las vencidas ni las ya expiradas", async () => {
    const vigente = new Date("2027-01-02T00:00:00Z");
    const vencida = new Date("2026-12-31T00:00:00Z");
    const { servicio } = crear({
      candidatas: [
        { status: "en_revision", expiresAt: vencida, pasajeros: 1 },
        { status: "pendiente", expiresAt: vigente, pasajeros: 1 },
        { status: "pendiente", expiresAt: vencida, pasajeros: 10 },
      ],
    });
    // Retenidos = 2; caben exactamente 2 más.
    await servicio.create(solicitud([adulto, adulto]));
    const { servicio: lleno } = crear({
      candidatas: [
        { status: "en_revision", expiresAt: vencida, pasajeros: 1 },
        { status: "pendiente", expiresAt: vigente, pasajeros: 1 },
      ],
    });
    await expect(lleno.create(solicitud([adulto, adulto, adulto]))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  test("salida inexistente, no publicada, cancelada, con paquete no publicado o ya iniciada → 422", async () => {
    const casos: (Partial<SalidaBloqueada> | null)[] = [
      null,
      { status: "borrador" },
      { status: "cancelada" },
      { packageStatus: "archivado" },
      { startsAt: AHORA },
    ];
    for (const salida of casos) {
      const { servicio, escrituras } = crear({ salida });
      await expect(servicio.create(solicitud([adulto]))).rejects.toBeInstanceOf(BusinessRuleError);
      expect(escrituras.reservas).toHaveLength(0);
    }
  });

  test("punto no asignado a la salida → 422 sin escrituras", async () => {
    const { servicio, escrituras } = crear({ puntos: [] });
    await expect(servicio.create(solicitud([adulto]))).rejects.toBeInstanceOf(BusinessRuleError);
    expect(escrituras).toEqual({ reservas: [], pasajeros: [], eventos: [] });
  });

  test("reintenta ante colisión de referencia, hasta 3 intentos", async () => {
    const { servicio, escrituras } = crear({ colisiones: 2 });
    await servicio.create(solicitud([adulto]));
    expect(escrituras.reservas).toHaveLength(1);

    const { servicio: agotado, escrituras: vacias } = crear({ colisiones: 3 });
    await expect(agotado.create(solicitud([adulto]))).rejects.toBeInstanceOf(InternalError);
    expect(vacias.reservas).toHaveLength(0);
  });

  test("una solicitud inválida falla antes de abrir la transacción", async () => {
    let abierta = false;
    const servicio = new BookingService(
      { transaction: () => ((abierta = true), Promise.reject(new Error("no debía abrirse"))) },
      { holdHours: 24 },
    );
    await expect(servicio.create(solicitud([]))).rejects.toBeInstanceOf(BusinessRuleError);
    expect(abierta).toBe(false);
  });
});
