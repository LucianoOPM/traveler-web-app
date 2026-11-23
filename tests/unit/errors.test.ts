import { describe, expect, test } from "bun:test";
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../src/lib/errors";

describe("jerarquía de errores", () => {
  test("cada clase usa su estado y su código por defecto", () => {
    const tabla = [
      [ValidationError, 400, "validation_error"],
      [UnauthenticatedError, 401, "unauthenticated"],
      [ForbiddenError, 403, "forbidden"],
      [NotFoundError, 404, "not_found"],
      [ConflictError, 409, "conflict"],
      [BusinessRuleError, 422, "business_rule_violation"],
      [InternalError, 500, "internal_error"],
    ] as const;
    for (const [Clase, status, code] of tabla) {
      const error = new Clase("mensaje");
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe("mensaje");
      expect(error.name).toBe(Clase.name);
    }
  });

  test("conserva un código específico", () => {
    const capacidad = new ConflictError("No hay capacidad disponible", {
      code: "capacity_exceeded",
    });
    expect(capacidad.code).toBe("capacity_exceeded");
    expect(capacidad.status).toBe(409);
    expect(capacidad.message).toBe("No hay capacidad disponible");

    const abordado = new BusinessRuleError("El pasajero ya abordó", { code: "already_boarded" });
    expect(abordado.code).toBe("already_boarded");
    expect(abordado.status).toBe(422);
  });

  test("es instancia de Error y de AppError, con cause opcional", () => {
    const causa = new Error("causa original");
    const error = new NotFoundError("No existe", { cause: causa });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.cause).toBe(causa);
    expect(new NotFoundError("No existe").cause).toBeUndefined();
  });

  test("ValidationError conserva details como lista de field y message", () => {
    const details = [
      { field: "email", message: "Formato inválido" },
      { field: "pasajeros", message: "Debe ser mayor que cero" },
    ];
    const error = new ValidationError("Datos inválidos", { details });
    expect(error.details).toEqual(details);
    expect(new ValidationError("Datos inválidos").details).toBeUndefined();
  });
});
