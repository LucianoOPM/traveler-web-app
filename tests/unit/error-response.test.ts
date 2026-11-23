import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ConflictError, InternalError, ValidationError } from "../../src/lib/errors";
import { toErrorResponse } from "../../src/lib/error-response";

const contexto = { method: "GET", path: "/api/prueba" };
const GENERICO = { error: { code: "internal_error", message: "Error interno del servidor" } };

let registro: ReturnType<typeof spyOn>;
beforeEach(() => {
  registro = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => registro.mockRestore());

describe("toErrorResponse", () => {
  test("un error tipado responde con su estado, código y mensaje", async () => {
    const respuesta = toErrorResponse(
      new ConflictError("No hay capacidad", { code: "capacity_exceeded" }),
      contexto,
    );
    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toEqual({
      error: { code: "capacity_exceeded", message: "No hay capacidad" },
    });
  });

  test("ValidationError incluye details", async () => {
    const details = [{ field: "email", message: "Formato inválido" }];
    const respuesta = toErrorResponse(
      new ValidationError("Datos inválidos", { details }),
      contexto,
    );
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error.details).toEqual(details);
  });

  test("InternalError y errores desconocidos responden 500 genérico sin filtrar datos", async () => {
    for (const error of [
      new InternalError("SECRETO"),
      new Error("SECRETO", { cause: "SECRETO" }),
      "SECRETO",
    ]) {
      const respuesta = toErrorResponse(error, contexto);
      expect(respuesta.status).toBe(500);
      expect(await respuesta.json()).toEqual(GENERICO);
    }
    expect(JSON.stringify(registro.mock.calls)).not.toContain("SECRETO");
  });

  test("el registro lleva el nombre del error, el método y la ruta", () => {
    toErrorResponse(new TypeError("x"), contexto);
    const linea = JSON.parse(registro.mock.calls[0]![0] as string);
    expect(linea).toMatchObject({ errorName: "TypeError", method: "GET", path: "/api/prueba" });
  });
});
