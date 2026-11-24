import { describe, expect, test } from "bun:test";
import { ConflictError } from "@lib/errors";
import {
  admiteInstrucciones,
  construirSnapshot,
  decidirSolicitud,
  elegirCuenta,
} from "@modules/payments/domain/allocation-rules";

const cuenta = (id: string, priority: number, limite: number, usado = 0) => ({
  id,
  priority,
  monthlyLimitCents: limite,
  committedCents: usado,
});

describe("elegirCuenta", () => {
  test("elige la de mayor prioridad (menor número) que soporta el importe completo", () => {
    const cuentas = [cuenta("b", 2, 1000), cuenta("a", 1, 1000)];
    expect(elegirCuenta(cuentas, 500)?.id).toBe("a");
  });

  test("salta la prioritaria sin capacidad y no divide el importe", () => {
    const cuentas = [cuenta("a", 1, 1000, 600), cuenta("b", 2, 1000, 600)];
    // Suman 800 libres, pero ninguna soporta 500 por sí sola.
    expect(elegirCuenta(cuentas, 500)).toBeNull();
    expect(elegirCuenta(cuentas, 400)?.id).toBe("a");
  });

  test("la capacidad exacta alcanza y un centavo de más no", () => {
    expect(elegirCuenta([cuenta("a", 1, 1000, 400)], 600)?.id).toBe("a");
    expect(elegirCuenta([cuenta("a", 1, 1000, 400)], 601)).toBeNull();
  });

  test("a igual prioridad desempata por id y sin cuentas devuelve null", () => {
    expect(elegirCuenta([cuenta("b", 1, 100), cuenta("a", 1, 100)], 50)?.id).toBe("a");
    expect(elegirCuenta([], 1)).toBeNull();
  });
});

describe("decidirSolicitud", () => {
  test("pendiente y parcial asignan; en_revision solo recupera", () => {
    expect(decidirSolicitud("pendiente")).toBe("asignar");
    expect(decidirSolicitud("parcial")).toBe("asignar");
    expect(decidirSolicitud("en_revision")).toBe("solo_existente");
  });

  test("pagada, expirada y cancelada no reciben instrucciones", () => {
    for (const estado of ["pagada", "expirada", "cancelada"] as const) {
      expect(() => decidirSolicitud(estado)).toThrow(ConflictError);
      expect(admiteInstrucciones(estado)).toBe(false);
    }
  });
});

test("construirSnapshot congela los datos bancarios y el importe completo de la reserva", () => {
  const s = construirSnapshot(
    { bankName: "Banco", accountHolder: "Titular", clabe: "012345678901234567" },
    { reference: "TT-ABC", totalCents: 150000 },
    "2026-11",
  );
  expect(s).toEqual({
    bankName: "Banco",
    accountHolder: "Titular",
    clabe: "012345678901234567",
    reference: "TT-ABC",
    amountCents: 150000,
    calendarMonth: "2026-11",
  });
});
