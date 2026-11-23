import { describe, expect, test } from "bun:test";
import { centavosAPesos, formatearPesos, pesosACentavos } from "@lib/importes";

describe("formatearPesos", () => {
  // Bun debe aceptar el string decimal de `centavosAPesos` en `Intl.NumberFormat` sin pasar por `number`.
  test.each([
    [150050, "$1,500.50"],
    [1999, "$19.99"],
    [0, "$0.00"],
    [1, "$0.01"],
    [2_147_483_647, "$21,474,836.47"],
  ])("%i centavos → %j", (centavos, texto) => {
    expect(formatearPesos(centavos).replace(/\s/g, " ")).toBe(texto);
  });
});

describe("pesosACentavos", () => {
  test.each([
    ["1500", 150000],
    ["1500.5", 150050],
    ["1500.50", 150050],
    ["0", 0],
    ["0.01", 1],
    [".5", 50],
    ["  12 ", 1200],
  ])("%j → %i (exacto)", (texto, centavos) => {
    expect(pesosACentavos(texto)).toBe(centavos);
  });

  test.each([
    ["19.99", 1999],
    ["0.29", 29],
    ["1.15", 115],
  ])("%j → %i (sin error de punto flotante)", (texto, centavos) => {
    expect(pesosACentavos(texto)).toBe(centavos);
  });

  test.each(["1.005", "1.999"])("decimales de más %j → null", (texto) => {
    expect(pesosACentavos(texto)).toBeNull();
  });

  test.each(["-1", "-0.01", "+5"])("negativo o con signo %j → null", (texto) => {
    expect(pesosACentavos(texto)).toBeNull();
  });

  test.each(["", "   ", "abc", "1e3", "1,500.50", "1500,50", "1.2.3"])(
    "vacío o ambiguo %j → null",
    (texto) => {
      expect(pesosACentavos(texto)).toBeNull();
    },
  );

  test("respeta el máximo de integer de PostgreSQL", () => {
    expect(pesosACentavos("21474836.47")).toBe(2_147_483_647);
    expect(pesosACentavos("21474836.48")).toBeNull();
  });
});

describe("centavosAPesos", () => {
  test("siempre dos decimales, sin separador de miles", () => {
    expect(centavosAPesos(150050)).toBe("1500.50");
    expect(centavosAPesos(5)).toBe("0.05");
    expect(centavosAPesos(0)).toBe("0.00");
  });

  test.each([0, 1, 99, 100, 150050, 2_147_483_647])("ida y vuelta de %i", (n) => {
    expect(pesosACentavos(centavosAPesos(n))).toBe(n);
  });
});
