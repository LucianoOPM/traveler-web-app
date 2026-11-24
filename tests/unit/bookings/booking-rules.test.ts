import { describe, expect, test } from "bun:test";
import { BusinessRuleError, ConflictError } from "@lib/errors";
import {
  generarReferencia,
  generarToken,
  hashDeToken,
} from "@modules/bookings/domain/access-token";
import {
  calcularExpiracion,
  comprobarCapacidad,
  comprobarSalidaReservable,
  comprobarSolicitud,
  precioPorCategoria,
  retieneInventario,
  type SolicitudReserva,
} from "@modules/bookings/domain/booking-rules";

const ahora = new Date("2027-01-10T12:00:00Z");
const enHoras = (h: number) => new Date(ahora.getTime() + h * 3_600_000);

describe("retieneInventario", () => {
  test("pendiente retiene solo mientras expires_at es posterior a ahora", () => {
    expect(retieneInventario({ status: "pendiente", expiresAt: enHoras(1) }, ahora)).toBe(true);
    expect(retieneInventario({ status: "pendiente", expiresAt: ahora }, ahora)).toBe(false);
    expect(retieneInventario({ status: "pendiente", expiresAt: enHoras(-1) }, ahora)).toBe(false);
  });

  test("en_revision retiene siempre, aunque expires_at ya haya pasado", () => {
    expect(retieneInventario({ status: "en_revision", expiresAt: enHoras(-48) }, ahora)).toBe(true);
    expect(retieneInventario({ status: "en_revision", expiresAt: enHoras(48) }, ahora)).toBe(true);
  });

  test("parcial y pagada retienen siempre, como en_revision (ADR-029)", () => {
    for (const status of ["parcial", "pagada"] as const) {
      expect(retieneInventario({ status, expiresAt: enHoras(-48) }, ahora)).toBe(true);
      expect(retieneInventario({ status, expiresAt: enHoras(48) }, ahora)).toBe(true);
    }
  });

  test("expirada y cancelada nunca retienen, aunque expires_at sea futuro", () => {
    for (const status of ["expirada", "cancelada"] as const) {
      expect(retieneInventario({ status, expiresAt: enHoras(48) }, ahora)).toBe(false);
    }
  });
});

describe("reglas de la reserva nueva", () => {
  const base: SolicitudReserva = {
    departureId: "d",
    boardingPointId: "p",
    buyerName: "Ana",
    buyerPhone: "5555555555",
    buyerEmail: "ana@example.com",
    passengers: [{ fullName: "Ana", fareCategory: "adulto" }],
  };
  const con = (cambios: Partial<SolicitudReserva>) => ({ ...base, ...cambios });
  const pasajeros = (n: number) =>
    Array.from({ length: n }, () => ({ fullName: "P", fareCategory: "infante" as const }));

  test("acepta de 1 a 10 pasajeros y rechaza 0 u 11", () => {
    expect(() => comprobarSolicitud(con({ passengers: pasajeros(1) }))).not.toThrow();
    expect(() => comprobarSolicitud(con({ passengers: pasajeros(10) }))).not.toThrow();
    expect(() => comprobarSolicitud(con({ passengers: [] }))).toThrow(BusinessRuleError);
    expect(() => comprobarSolicitud(con({ passengers: pasajeros(11) }))).toThrow(BusinessRuleError);
  });

  test("rechaza categoría inválida, pasajero sin nombre y contacto incompleto", () => {
    const mala = [
      { fullName: "A", fareCategory: "senior" },
    ] as unknown as SolicitudReserva["passengers"];
    expect(() => comprobarSolicitud(con({ passengers: mala }))).toThrow(BusinessRuleError);
    const sinNombre = [{ fullName: "  ", fareCategory: "adulto" as const }];
    expect(() => comprobarSolicitud(con({ passengers: sinNombre }))).toThrow(BusinessRuleError);
    for (const campo of ["buyerName", "buyerPhone", "buyerEmail"] as const) {
      expect(() => comprobarSolicitud(con({ [campo]: " " }))).toThrow(BusinessRuleError);
    }
    expect(() => comprobarSolicitud(con({ buyerEmail: "no-es-correo" }))).toThrow(
      BusinessRuleError,
    );
  });

  test("la salida debe estar publicada, con paquete publicado y futura", () => {
    const futura = new Date(ahora.getTime() + 1000);
    const ok = { status: "publicada" as const, startsAt: futura };
    expect(() => comprobarSalidaReservable(ok, "publicado", ahora)).not.toThrow();
    expect(() =>
      comprobarSalidaReservable({ ...ok, status: "borrador" }, "publicado", ahora),
    ).toThrow();
    expect(() =>
      comprobarSalidaReservable({ ...ok, status: "cancelada" }, "publicado", ahora),
    ).toThrow();
    expect(() => comprobarSalidaReservable(ok, "archivado", ahora)).toThrow();
    expect(() =>
      comprobarSalidaReservable({ ...ok, startsAt: ahora }, "publicado", ahora),
    ).toThrow();
  });

  test("el precio sale de la categoría de la salida", () => {
    const s = { adultPriceCents: 300, childPriceCents: 200, infantPriceCents: 0 };
    expect(precioPorCategoria(s, "adulto")).toBe(300);
    expect(precioPorCategoria(s, "menor")).toBe(200);
    expect(precioPorCategoria(s, "infante")).toBe(0);
  });

  test("expires_at es min(ahora + horas, starts_at)", () => {
    expect(calcularExpiracion(ahora, 24, enHoras(100))).toEqual(enHoras(24));
    expect(calcularExpiracion(ahora, 24, enHoras(5))).toEqual(enHoras(5));
  });

  test("capacidad: cabe justo, pero no uno más (409 capacity_exceeded)", () => {
    expect(() => comprobarCapacidad(7, 3, 10)).not.toThrow();
    try {
      comprobarCapacidad(8, 3, 10);
      throw new Error("debía lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).code).toBe("capacity_exceeded");
    }
  });

  test("token y referencia: formato, unicidad y hash SHA-256", () => {
    const token = generarToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(generarToken());
    expect(hashDeToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeToken(token)).not.toContain(token);
    expect(generarReferencia()).toMatch(/^TT-[A-HJKMNP-Z2-9]{8}$/);
  });
});
