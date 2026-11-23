import { describe, expect, test } from "bun:test";
import { localAUtc, utcALocal } from "../../src/lib/fechas";

const MX = "America/Mexico_City"; // UTC−6 fijo desde 2022
const NY = "America/New_York"; // con horario de verano: la agencia podría cambiar de zona

describe("localAUtc", () => {
  test("zona de la agencia → UTC, incluido el cruce de día", () => {
    expect(localAUtc("2027-01-10T10:00", MX)).toBe("2027-01-10T16:00:00.000Z");
    expect(localAUtc("2027-01-10T22:00", MX)).toBe("2027-01-11T04:00:00.000Z");
  });

  test("UTC es la identidad", () => {
    expect(localAUtc("2027-01-10T10:00", "UTC")).toBe("2027-01-10T10:00:00.000Z");
  });

  test("respeta el horario de verano", () => {
    expect(localAUtc("2027-01-15T12:00", NY)).toBe("2027-01-15T17:00:00.000Z");
    expect(localAUtc("2027-07-01T12:00", NY)).toBe("2027-07-01T16:00:00.000Z");
    expect(localAUtc("2027-03-14T03:30", NY)).toBe("2027-03-14T07:30:00.000Z");
  });

  test("hora inexistente (salto de primavera) → null", () => {
    expect(localAUtc("2027-03-14T02:30", NY)).toBeNull();
  });

  test("hora ambigua (fin del horario de verano) → primera ocurrencia", () => {
    expect(localAUtc("2027-11-07T01:30", NY)).toBe("2027-11-07T05:30:00.000Z");
  });

  test.each(["", "2027-02-30T10:00", "2027-01-10", "2027-01-10T25:00", "2027-01-10T10:00:00"])(
    "texto inválido %j → null",
    (texto) => {
      expect(localAUtc(texto, MX)).toBeNull();
    },
  );
});

describe("utcALocal", () => {
  test("UTC → zona de la agencia", () => {
    expect(utcALocal("2027-01-11T04:00:00.000Z", MX)).toBe("2027-01-10T22:00");
    expect(utcALocal(new Date("2027-01-10T16:00:00Z"), MX)).toBe("2027-01-10T10:00");
  });

  test.each([
    ["2027-01-10T10:00", MX],
    ["2027-01-10T22:00", MX],
    ["2027-07-01T12:00", NY],
    ["2027-03-14T03:30", NY],
    ["2027-11-07T01:30", NY],
  ])("ida y vuelta de %s en %s", (local, zona) => {
    expect(utcALocal(localAUtc(local, zona)!, zona)).toBe(local);
  });
});
