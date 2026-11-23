import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toActionErrorData } from "@lib/action-errors";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  TooManyRequestsError,
  UnauthenticatedError,
  ValidationError,
} from "@lib/errors";

let registro: ReturnType<typeof spyOn>;
beforeEach(() => {
  registro = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => registro.mockRestore());

const contexto = { action: "catalog.prueba" };

describe("toActionErrorData", () => {
  test.each([
    [new ValidationError("x"), "BAD_REQUEST"],
    [new UnauthenticatedError("x"), "UNAUTHORIZED"],
    [new ForbiddenError("x"), "FORBIDDEN"],
    [new NotFoundError("x"), "NOT_FOUND"],
    [new ConflictError("x"), "CONFLICT"],
    [new BusinessRuleError("x"), "UNPROCESSABLE_CONTENT"],
    [new TooManyRequestsError("x"), "TOO_MANY_REQUESTS"],
  ] as const)("%o → %s con su mensaje público", (error, code) => {
    expect(toActionErrorData(error, contexto)).toEqual({ code, message: "x" });
  });

  test("un error inesperado no filtra su mensaje ni su causa", () => {
    const error = new Error("password=secreto host=db-interna", { cause: "detalle" });
    const datos = toActionErrorData(error, contexto);
    expect(datos).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno del servidor",
    });
    const registrado = JSON.stringify(registro.mock.calls);
    expect(registrado).not.toContain("secreto");
    expect(registrado).toContain("catalog.prueba");
  });

  test("InternalError y valores no Error responden genérico", () => {
    for (const error of [new InternalError("detalle privado"), "texto", undefined]) {
      expect(toActionErrorData(error, contexto)).toEqual({
        code: "INTERNAL_SERVER_ERROR",
        message: "Error interno del servidor",
      });
    }
  });
});
