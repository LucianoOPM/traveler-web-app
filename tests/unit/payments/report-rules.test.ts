import { describe, expect, test } from "bun:test";
import { BusinessRuleError, ConflictError } from "@lib/errors";
import {
  comprobarEstadoParaReportar,
  comprobarImporte,
  huellaDe,
  mismosDatos,
  normalizarReporte,
  puedeReportar,
} from "@modules/payments/domain/report-rules";

const CLAVE = "5f1c1c0e-0000-4000-8000-000000000001";
const datos = (extra: object = {}) => ({ requestKey: CLAVE, amountCents: 1000, ...extra });

describe("normalizarReporte", () => {
  test("recorta la referencia y una cadena vacía o de espacios queda como null", () => {
    expect(normalizarReporte(datos({ trackingReference: "  ABC123  " })).trackingReference).toBe(
      "ABC123",
    );
    expect(normalizarReporte(datos({ trackingReference: "   " })).trackingReference).toBeNull();
    expect(normalizarReporte(datos({ trackingReference: "" })).trackingReference).toBeNull();
    expect(normalizarReporte(datos()).trackingReference).toBeNull();
  });

  test("la referencia admite 40 caracteres tras recortar y no 41", () => {
    expect(
      normalizarReporte(datos({ trackingReference: ` ${"a".repeat(40)} ` })).trackingReference,
    ).toHaveLength(40);
    expect(() => normalizarReporte(datos({ trackingReference: "a".repeat(41) }))).toThrow(
      BusinessRuleError,
    );
  });

  test("el importe debe ser un entero mayor que 0", () => {
    for (const amountCents of [0, -1, 1.5, NaN, 2_147_483_648]) {
      expect(() => normalizarReporte(datos({ amountCents }))).toThrow(BusinessRuleError);
    }
    expect(normalizarReporte(datos({ amountCents: 1 })).amountCents).toBe(1);
  });
});

test("comprobarImporte: hasta el saldo, inclusive; un centavo más no", () => {
  expect(() => comprobarImporte(7000, 7000)).not.toThrow();
  expect(() => comprobarImporte(7001, 7000)).toThrow(BusinessRuleError);
  expect(() => comprobarImporte(1, 0)).toThrow(BusinessRuleError);
});

test("solo pendiente, parcial y en_revision pueden reportar", () => {
  for (const e of ["pendiente", "parcial", "en_revision"] as const) {
    expect(puedeReportar(e)).toBe(true);
    expect(() => comprobarEstadoParaReportar(e)).not.toThrow();
  }
  for (const e of ["pagada", "expirada", "cancelada"] as const) {
    expect(puedeReportar(e)).toBe(false);
    expect(() => comprobarEstadoParaReportar(e)).toThrow(ConflictError);
  }
});

test("mismosDatos compara importe y referencia", () => {
  const base = { amountCents: 100, trackingReference: null };
  expect(mismosDatos(base, { ...base })).toBe(true);
  expect(mismosDatos(base, { ...base, amountCents: 101 })).toBe(false);
  expect(mismosDatos(base, { ...base, trackingReference: "x" })).toBe(false);
});

test("huellaDe es el SHA-256 del contenido: dos archivos del mismo tamaño y tipo se distinguen", () => {
  const a = new Uint8Array(1024).fill(7);
  const b = new Uint8Array(a);
  b[500] = 8; // mismo tamaño, un solo byte distinto
  expect(huellaDe(a)).toMatch(/^[0-9a-f]{64}$/);
  expect(huellaDe(a)).toBe(huellaDe(new Uint8Array(a)));
  expect(huellaDe(a)).not.toBe(huellaDe(b));
  // Vector conocido de SHA-256 para "abc".
  expect(huellaDe(new TextEncoder().encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
