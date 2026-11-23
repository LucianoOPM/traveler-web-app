import { describe, expect, test } from "bun:test";
import { retieneInventario } from "@modules/bookings/domain/booking-rules";

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

  test("expirada y cancelada nunca retienen, aunque expires_at sea futuro", () => {
    for (const status of ["expirada", "cancelada"] as const) {
      expect(retieneInventario({ status, expiresAt: enHoras(48) }, ahora)).toBe(false);
    }
  });
});
