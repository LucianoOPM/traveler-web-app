import { describe, expect, test } from "bun:test";
import { LIMITE_RESERVAS, LimiteDeSolicitudes } from "@modules/bookings/domain/rate-limit";

describe("LimiteDeSolicitudes", () => {
  const HORA = 60 * 60 * 1000;
  const crear = () => {
    let ahora = 1_000_000;
    const limite = new LimiteDeSolicitudes(5, HORA, () => ahora);
    return { limite, avanzar: (ms: number) => (ahora += ms) };
  };

  test("el límite es de 5 solicitudes por hora", () => {
    expect(LIMITE_RESERVAS).toEqual({ max: 5, ventanaMs: HORA });
  });

  test("permite 5 y rechaza la sexta; lo rechazado no ocupa cupo", () => {
    const { limite, avanzar } = crear();
    for (let i = 0; i < 5; i++) expect(limite.intentar("1.1.1.1")).toBe(true);
    expect(limite.intentar("1.1.1.1")).toBe(false);
    expect(limite.intentar("1.1.1.1")).toBe(false);
    // Al salir de la ventana la primera, vuelve a haber cupo para una sola.
    avanzar(HORA + 1);
    expect(limite.intentar("1.1.1.1")).toBe(true);
  });

  test("cada IP tiene su propio cupo", () => {
    const { limite } = crear();
    for (let i = 0; i < 5; i++) limite.intentar("1.1.1.1");
    expect(limite.intentar("1.1.1.1")).toBe(false);
    expect(limite.intentar("2.2.2.2")).toBe(true);
  });

  test("la ventana se desliza: las solicitudes viejas dejan de contar una a una", () => {
    const { limite, avanzar } = crear();
    limite.intentar("ip");
    avanzar(HORA / 2);
    for (let i = 0; i < 4; i++) limite.intentar("ip");
    expect(limite.intentar("ip")).toBe(false);
    avanzar(HORA / 2 + 1); // vence solo la primera
    expect(limite.intentar("ip")).toBe(true);
    expect(limite.intentar("ip")).toBe(false);
  });

  test("poda las claves sin solicitudes vigentes (el mapa no crece sin límite)", () => {
    const { limite, avanzar } = crear();
    for (let i = 0; i < 50; i++) limite.intentar(`ip-${i}`);
    avanzar(HORA + 1);
    limite.intentar("otra");
    expect((limite as unknown as { intentos: Map<string, number[]> }).intentos.size).toBe(1);
  });
});
