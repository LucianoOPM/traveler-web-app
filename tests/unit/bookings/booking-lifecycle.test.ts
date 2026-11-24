import { describe, expect, test } from "bun:test";
import { BookingService } from "@modules/bookings/application/booking-service";
import { hashDeToken } from "@modules/bookings/domain/access-token";
import type {
  BookingRepository,
  BookingTx,
  SalidaBloqueada,
} from "@modules/bookings/domain/booking-repository";
import {
  accionesPermitidas,
  comprobarMotivo,
  comprobarTokenRegenerable,
  decidirCancelacion,
  decidirReactivacion,
  estadoEfectivo,
} from "@modules/bookings/domain/booking-rules";
import type { Booking, BookingStatus, NewBookingEvent } from "@modules/bookings/types";
import { BusinessRuleError, ConflictError, NotFoundError } from "@lib/errors";

const AHORA = new Date("2027-01-01T12:00:00Z");
const hora = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);
const ADMIN = "5f1c1c0e-0000-4000-8000-0000000000ad";
const MOTIVO = { actorUserId: ADMIN, reason: "  motivo de prueba  " };

describe("reglas del ciclo de vida", () => {
  const estados: [string, Pick<Booking, "status" | "expiresAt">][] = [
    ["pendiente vigente", { status: "pendiente", expiresAt: hora(1) }],
    ["pendiente vencida sin materializar", { status: "pendiente", expiresAt: hora(-1) }],
    ["en_revision con plazo pasado", { status: "en_revision", expiresAt: hora(-48) }],
    ["expirada", { status: "expirada", expiresAt: hora(-1) }],
    ["cancelada", { status: "cancelada", expiresAt: hora(1) }],
    ["parcial con plazo pasado", { status: "parcial", expiresAt: hora(-48) }],
    ["pagada con plazo pasado", { status: "pagada", expiresAt: hora(-48) }],
  ];

  test("matriz: cancelar", () => {
    const esperado = [
      "cancelar",
      "409",
      "cancelar",
      "409",
      "repetida",
      "cancelar",
      "cancelar",
    ] as const;
    estados.forEach(([, reserva], i) => {
      if (esperado[i] === "409") {
        expect(() => decidirCancelacion(reserva, AHORA)).toThrow(ConflictError);
      } else {
        expect(decidirCancelacion(reserva, AHORA)).toBe(esperado[i]!);
      }
    });
  });

  test("matriz: reactivar", () => {
    const esperado = [
      "repetida",
      "reactivar",
      "repetida",
      "reactivar",
      "reactivar",
      "repetida",
      "repetida",
    ] as const;
    estados.forEach(([, reserva], i) => {
      expect(decidirReactivacion(reserva, AHORA)).toBe(esperado[i]!);
    });
  });

  test("matriz: regenerar enlace solo en vigentes (pendiente no vencida, en_revision, parcial o pagada)", () => {
    const vigente = [true, false, true, false, false, true, true];
    estados.forEach(([, reserva], i) => {
      if (vigente[i]) expect(() => comprobarTokenRegenerable(reserva, AHORA)).not.toThrow();
      else expect(() => comprobarTokenRegenerable(reserva, AHORA)).toThrow(ConflictError);
    });
  });

  test("las acciones ofrecidas coinciden con las reglas", () => {
    expect(estados.map(([, r]) => accionesPermitidas(r, AHORA))).toEqual([
      ["cancelar", "regenerar"],
      ["reactivar"],
      ["cancelar", "regenerar"],
      ["reactivar"],
      ["reactivar"],
      ["cancelar", "regenerar"],
      ["cancelar", "regenerar"],
    ]);
    expect(estadoEfectivo(estados[5]![1], AHORA)).toBe("parcial");
    expect(estadoEfectivo(estados[1]![1], AHORA)).toBe("expirada");
    expect(estadoEfectivo(estados[2]![1], AHORA)).toBe("en_revision");
  });

  test("el motivo es obligatorio, sin solo espacios, de hasta 500 caracteres y se recorta", () => {
    for (const malo of ["", "   ", "\n\t "]) {
      expect(() => comprobarMotivo(malo)).toThrow(BusinessRuleError);
    }
    expect(() => comprobarMotivo("x".repeat(501))).toThrow(BusinessRuleError);
    expect(comprobarMotivo("x".repeat(500))).toHaveLength(500);
    expect(comprobarMotivo("  hola  ")).toBe("hola");
  });
});

// Repositorio en memoria con la semántica de la transacción real: si la operación lanza, se
// restaura todo; si devuelve (también un rechazo como valor), se conserva lo escrito.
function crear(
  opciones: {
    capacity?: number;
    salida?: Partial<SalidaBloqueada>;
    reservas?: {
      id: string;
      status: BookingStatus;
      expiresAt: Date;
      pasajeros?: number;
      hash?: string;
    }[];
    fallaEnEvento?: boolean;
  } = {},
) {
  const salida: SalidaBloqueada = {
    id: "s1",
    packageId: "p1",
    startsAt: hora(24 * 30),
    endsAt: hora(24 * 32),
    capacity: opciones.capacity ?? 4,
    adultPriceCents: 1,
    childPriceCents: 1,
    infantPriceCents: 0,
    status: "publicada",
    createdAt: AHORA,
    updatedAt: AHORA,
    packageStatus: "publicado",
    ...opciones.salida,
  };
  let reservas = new Map(
    (opciones.reservas ?? []).map((r) => [
      r.id,
      {
        id: r.id,
        reference: `TT-${r.id}`,
        departureId: "s1",
        buyerName: "Ana",
        buyerPhone: "1",
        buyerEmail: "a@b.co",
        boardingPointId: "b1",
        status: r.status,
        expiresAt: r.expiresAt,
        totalCents: 0,
        accessTokenHash: r.hash ?? `hash-${r.id}`,
        createdAt: AHORA,
        updatedAt: AHORA,
        pasajeros: r.pasajeros ?? 1,
      },
    ]),
  );
  let eventos: NewBookingEvent[] = [];

  const tx: BookingTx = {
    bloquearSalida: async (id) => (id === salida.id ? salida : null),
    puntoAsignado: async () => true,
    reservasCandidatas: async () =>
      [...reservas.values()].filter((r) =>
        ["pendiente", "en_revision", "parcial", "pagada"].includes(r.status),
      ),
    insertarReserva: async () => null,
    insertarPasajeros: async () => {},
    insertarEvento: async (e) => {
      if (opciones.fallaEnEvento && e.type !== "expirada") throw new Error("fallo simulado");
      eventos.push(e);
    },
    salidaDeReserva: async (id) => (reservas.has(id) ? "s1" : null),
    buscarReserva: async (id) => (reservas.has(id) ? { ...reservas.get(id)! } : null),
    cambiarReserva: async (id, esperado, cambios) => {
      const r = reservas.get(id);
      if (!r || r.status !== esperado) return false;
      reservas.set(id, { ...r, ...cambios });
      return true;
    },
    liberarAsignacion: async () => {},
    expirarVencidas: async (_s, ahora) => {
      for (const r of reservas.values()) {
        if (r.status === "pendiente" && r.expiresAt <= ahora) {
          reservas.set(r.id, { ...r, status: "expirada" });
          eventos.push({
            bookingId: r.id,
            type: "expirada",
            actorType: "sistema",
            fromStatus: "pendiente",
            toStatus: "expirada",
          });
        }
      }
    },
  };
  const repo: BookingRepository = {
    findByTokenHash: async () => null,
    listarPorSalida: async () => ({
      salida: {
        id: "s1",
        packageId: "p1",
        packageName: "P",
        startsAt: salida.startsAt,
        endsAt: salida.endsAt,
        capacity: salida.capacity,
      },
      reservas: [...reservas.values()].map((r) => ({ ...r, boardingPointName: "Punto" })),
    }),
    transaction: async (fn) => {
      const copia = { reservas: new Map(reservas), eventos: [...eventos] };
      try {
        return await fn(tx);
      } catch (error) {
        reservas = copia.reservas;
        eventos = copia.eventos;
        throw error;
      }
    },
  };
  return {
    servicio: new BookingService(repo, { holdHours: 24, ahora: () => AHORA }),
    estado: (id: string) => reservas.get(id)!,
    eventos: () => eventos,
  };
}

const vigente = { status: "pendiente" as const, expiresAt: hora(5) };
const vencida = { status: "pendiente" as const, expiresAt: hora(-1) };

describe("BookingService.cancel", () => {
  test("desde pendiente y en_revision: cancela y deja evento con actor, motivo y estados", async () => {
    for (const status of ["pendiente", "en_revision"] as const) {
      const { servicio, estado, eventos } = crear({
        reservas: [{ id: "r1", status, expiresAt: hora(5) }],
      });
      expect(await servicio.cancel("r1", MOTIVO)).toEqual({ status: "cancelada", cambio: true });
      expect(estado("r1").status).toBe("cancelada");
      expect(eventos()).toEqual([
        {
          bookingId: "r1",
          type: "cancelada",
          actorType: "admin",
          actorUserId: ADMIN,
          fromStatus: status,
          toStatus: "cancelada",
          reason: "motivo de prueba",
        },
      ]);
    }
  });

  test("repetida: éxito idempotente sin evento duplicado", async () => {
    const { servicio, eventos } = crear({ reservas: [{ id: "r1", ...vigente }] });
    await servicio.cancel("r1", MOTIVO);
    expect(await servicio.cancel("r1", MOTIVO)).toEqual({ status: "cancelada", cambio: false });
    expect(eventos()).toHaveLength(1);
  });

  test("desde expirada da 409 y no deja evento", async () => {
    const { servicio, eventos } = crear({
      reservas: [{ id: "r1", status: "expirada", expiresAt: hora(-1) }],
    });
    await expect(servicio.cancel("r1", MOTIVO)).rejects.toBeInstanceOf(ConflictError);
    expect(eventos()).toEqual([]);
  });

  test("una pendiente vencida sin materializar se trata como expirada: 409", async () => {
    const { servicio } = crear({ reservas: [{ id: "r1", ...vencida }] });
    await expect(servicio.cancel("r1", MOTIVO)).rejects.toBeInstanceOf(ConflictError);
  });

  test("reserva inexistente: 404; motivo vacío: 422 sin abrir transacción", async () => {
    const { servicio } = crear();
    await expect(servicio.cancel("nada", MOTIVO)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      servicio.cancel("r1", { actorUserId: ADMIN, reason: "   " }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("BookingService.reactivate", () => {
  test("desde expirada o cancelada con capacidad: pendiente con nuevo vencimiento y evento", async () => {
    for (const status of ["expirada", "cancelada"] as const) {
      const { servicio, estado, eventos } = crear({
        reservas: [{ id: "r1", status, expiresAt: hora(-30), pasajeros: 2 }],
      });
      const r = await servicio.reactivate("r1", MOTIVO);
      expect(r).toEqual({ status: "pendiente", expiresAt: hora(24), cambio: true });
      expect(estado("r1")).toMatchObject({ status: "pendiente", expiresAt: hora(24) });
      expect(eventos()).toEqual([
        {
          bookingId: "r1",
          type: "reactivada",
          actorType: "admin",
          actorUserId: ADMIN,
          fromStatus: status,
          toStatus: "pendiente",
          reason: "motivo de prueba",
        },
      ]);
    }
  });

  test("el vencimiento nunca supera el inicio de la salida", async () => {
    const { servicio } = crear({
      salida: { startsAt: hora(3) },
      reservas: [{ id: "r1", status: "expirada", expiresAt: hora(-1) }],
    });
    expect((await servicio.reactivate("r1", MOTIVO)).expiresAt).toEqual(hora(3));
  });

  test("sin capacidad da 409 y la reserva sigue como estaba; con exactamente la capacidad, sí", async () => {
    const lleno = crear({
      capacity: 3,
      reservas: [
        { id: "r1", status: "expirada", expiresAt: hora(-1), pasajeros: 2 },
        { id: "r2", ...vigente, pasajeros: 2 },
      ],
    });
    await expect(lleno.servicio.reactivate("r1", MOTIVO)).rejects.toMatchObject({
      status: 409,
      code: "capacity_exceeded",
    });
    expect(lleno.estado("r1").status).toBe("expirada");
    expect(lleno.eventos()).toEqual([]);

    const justo = crear({
      capacity: 4,
      reservas: [
        { id: "r1", status: "expirada", expiresAt: hora(-1), pasajeros: 2 },
        { id: "r2", ...vigente, pasajeros: 2 },
      ],
    });
    expect((await justo.servicio.reactivate("r1", MOTIVO)).cambio).toBe(true);
  });

  test("las pendientes vencidas y las canceladas de otras reservas no ocupan lugar", async () => {
    const { servicio } = crear({
      capacity: 2,
      reservas: [
        { id: "r1", status: "expirada", expiresAt: hora(-1), pasajeros: 2 },
        { id: "r2", ...vencida, pasajeros: 5 },
        { id: "r3", status: "cancelada", expiresAt: hora(9), pasajeros: 5 },
      ],
    });
    expect((await servicio.reactivate("r1", MOTIVO)).cambio).toBe(true);
  });

  test("una en_revision retiene siempre y bloquea la reactivación de otra", async () => {
    const { servicio } = crear({
      capacity: 2,
      reservas: [
        { id: "r1", status: "expirada", expiresAt: hora(-1), pasajeros: 2 },
        { id: "r2", status: "en_revision", expiresAt: hora(-100), pasajeros: 1 },
      ],
    });
    await expect(servicio.reactivate("r1", MOTIVO)).rejects.toMatchObject({ status: 409 });
  });

  test("repetida sobre una ya reactivada: idempotente, sin renovar el vencimiento ni evento", async () => {
    const { servicio, estado, eventos } = crear({
      reservas: [{ id: "r1", status: "expirada", expiresAt: hora(-1) }],
    });
    await servicio.reactivate("r1", MOTIVO);
    const antes = estado("r1").expiresAt;
    const r = await servicio.reactivate("r1", MOTIVO);
    expect(r).toEqual({ status: "pendiente", expiresAt: antes, cambio: false });
    expect(eventos()).toHaveLength(1);

    const revision = crear({
      reservas: [{ id: "r1", status: "en_revision", expiresAt: hora(-9) }],
    });
    expect((await revision.servicio.reactivate("r1", MOTIVO)).cambio).toBe(false);
    expect(revision.eventos()).toEqual([]);
  });

  test("salida cancelada, ya iniciada o con paquete no publicado: 422", async () => {
    for (const salida of [
      { status: "cancelada" as const },
      { startsAt: hora(-1) },
      { packageStatus: "archivado" as const },
    ]) {
      const { servicio, eventos } = crear({
        salida,
        reservas: [{ id: "r1", status: "cancelada", expiresAt: hora(1) }],
      });
      await expect(servicio.reactivate("r1", MOTIVO)).rejects.toBeInstanceOf(BusinessRuleError);
      expect(eventos()).toEqual([]);
    }
  });
});

describe("BookingService.regenerateToken", () => {
  test("reemplaza el hash y devuelve el token nuevo; el evento no guarda token ni hash", async () => {
    const { servicio, estado, eventos } = crear({
      reservas: [{ id: "r1", ...vigente, hash: "hash-viejo" }],
    });
    const { token } = await servicio.regenerateToken("r1", MOTIVO);
    expect(estado("r1").accessTokenHash).toBe(hashDeToken(token));
    expect(estado("r1").accessTokenHash).not.toBe("hash-viejo");
    expect(estado("r1").status).toBe("pendiente");
    expect(eventos()).toEqual([
      {
        bookingId: "r1",
        type: "token_regenerado",
        actorType: "admin",
        actorUserId: ADMIN,
        reason: "motivo de prueba",
      },
    ]);
    const volcado = JSON.stringify(eventos());
    expect(volcado).not.toContain(token);
    expect(volcado).not.toContain(hashDeToken(token));
    expect(volcado).not.toContain("hash-viejo");
  });

  test("en_revision sí; expirada, cancelada o pendiente vencida: 409 sin cambios", async () => {
    const ok = crear({ reservas: [{ id: "r1", status: "en_revision", expiresAt: hora(-5) }] });
    await ok.servicio.regenerateToken("r1", MOTIVO);
    for (const reserva of [
      { status: "expirada" as const, expiresAt: hora(-1) },
      { status: "cancelada" as const, expiresAt: hora(1) },
      vencida,
    ]) {
      const { servicio, estado } = crear({ reservas: [{ id: "r1", ...reserva, hash: "h" }] });
      await expect(servicio.regenerateToken("r1", MOTIVO)).rejects.toBeInstanceOf(ConflictError);
      expect(estado("r1").accessTokenHash).toBe("h");
    }
  });
});

describe("expiración perezosa y rechazos", () => {
  test("una operación rechazada conserva las expiraciones materializadas (y solo esas)", async () => {
    const { servicio, estado, eventos } = crear({
      reservas: [
        { id: "vieja", ...vencida },
        { id: "exp", status: "expirada", expiresAt: hora(-9) },
      ],
    });
    await expect(servicio.cancel("exp", MOTIVO)).rejects.toBeInstanceOf(ConflictError);
    expect(estado("vieja").status).toBe("expirada");
    expect(eventos()).toEqual([
      {
        bookingId: "vieja",
        type: "expirada",
        actorType: "sistema",
        fromStatus: "pendiente",
        toStatus: "expirada",
      },
    ]);
  });

  test("un error inesperado sí revierte todo, incluida la expiración", async () => {
    const { servicio, estado, eventos } = crear({
      fallaEnEvento: true,
      reservas: [
        { id: "vieja", ...vencida },
        { id: "r1", ...vigente },
      ],
    });
    await expect(servicio.cancel("r1", MOTIVO)).rejects.toThrow("fallo simulado");
    expect(estado("r1").status).toBe("pendiente");
    expect(estado("vieja").status).toBe("pendiente");
    expect(eventos()).toEqual([]);
  });

  test("en_revision nunca expira, aunque su plazo haya pasado", async () => {
    const { servicio, estado } = crear({
      reservas: [
        { id: "rev", status: "en_revision", expiresAt: hora(-500) },
        { id: "r1", ...vigente },
      ],
    });
    await servicio.cancel("r1", MOTIVO);
    expect(estado("rev").status).toBe("en_revision");
  });
});

describe("BookingService.listByDeparture", () => {
  test("muestra el estado visible y las acciones permitidas de cada reserva", async () => {
    const { servicio } = crear({
      reservas: [
        { id: "a", ...vigente },
        { id: "b", ...vencida },
        { id: "c", status: "cancelada", expiresAt: hora(1) },
      ],
    });
    const { reservas } = await servicio.listByDeparture("s1");
    expect(reservas.map((r) => [r.status, r.acciones])).toEqual([
      ["pendiente", ["cancelar", "regenerar"]],
      ["expirada", ["reactivar"]],
      ["cancelada", ["reactivar"]],
    ]);
  });
});
