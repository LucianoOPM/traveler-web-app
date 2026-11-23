import { describe, expect, test } from "bun:test";
import { erroresDeAccion } from "../../src/components/catalogo/errores";

describe("erroresDeAccion", () => {
  test("un error por campo se asocia al campo y no hay mensaje general", () => {
    const r = erroresDeAccion({ message: "x", fields: { name: ["Obligatorio"] } }, true);
    expect(r).toEqual({ campos: { name: "Obligatorio" }, general: null });
  });

  test("varios mensajes del mismo campo se unen con coma", () => {
    const r = erroresDeAccion({ message: "x", fields: { capacity: ["a", "b"] } }, true);
    expect(r.campos.capacity).toBe("a, b");
  });

  test("clave desconocida (sin fields) → mensaje general estable, sin el texto interno", () => {
    const r = erroresDeAccion({ message: 'Unrecognized key: "status"', fields: {} }, true);
    expect(r).toEqual({ campos: {}, general: "Revisa los datos enviados." });
  });

  test("campos con valor vacío o indefinido se ignoran", () => {
    const r = erroresDeAccion({ message: "x", fields: { a: undefined, b: [] } }, true);
    expect(r).toEqual({ campos: {}, general: "Revisa los datos enviados." });
  });

  test("error que no es de entrada → su mensaje público", () => {
    const r = erroresDeAccion({ message: "El paquete tiene salidas asociadas" }, false);
    expect(r).toEqual({ campos: {}, general: "El paquete tiene salidas asociadas" });
  });
});
