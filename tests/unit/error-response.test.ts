import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Mock } from "bun:test";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../src/lib/errors";
import { INTERNAL_ERROR_MESSAGE, toErrorResponse } from "../../src/lib/error-response";

const contexto = { method: "GET", path: "/api/v1/ejemplo" };
const GENERICO = { error: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE } };

let consola: Mock<typeof console.error>;

beforeEach(() => {
  consola = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consola.mockRestore();
});

async function cuerpoDe(response: Response): Promise<unknown> {
  return response.json();
}

function registro(): Record<string, unknown> {
  expect(consola).toHaveBeenCalledTimes(1);
  const argumentos = consola.mock.calls[0] ?? [];
  expect(argumentos).toHaveLength(1);
  expect(typeof argumentos[0]).toBe("string");
  return JSON.parse(argumentos[0] as string) as Record<string, unknown>;
}

describe("toErrorResponse con errores tipados", () => {
  test("convierte cada AppError en { error: { code, message } } con su estado", async () => {
    const tabla = [
      [new ValidationError("Datos inválidos"), 400, "validation_error"],
      [new UnauthenticatedError("Inicia sesión"), 401, "unauthenticated"],
      [new ForbiddenError("Sin permiso"), 403, "forbidden"],
      [new NotFoundError("No existe"), 404, "not_found"],
      [new ConflictError("Estado en conflicto"), 409, "conflict"],
      [new BusinessRuleError("Regla incumplida"), 422, "business_rule_violation"],
    ] as const;
    for (const [error, status, code] of tabla) {
      const response = toErrorResponse(error, contexto);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await cuerpoDe(response)).toEqual({ error: { code, message: error.message } });
    }
    expect(consola).not.toHaveBeenCalled();
  });

  test("preserva el código específico en la respuesta", async () => {
    const error = new ConflictError("No hay capacidad disponible", { code: "capacity_exceeded" });
    const response = toErrorResponse(error, contexto);
    expect(response.status).toBe(409);
    expect(await cuerpoDe(response)).toEqual({
      error: { code: "capacity_exceeded", message: "No hay capacidad disponible" },
    });
  });

  test("serializa details solo con field y message", async () => {
    const detalleConExtras = {
      field: "email",
      message: "Formato inválido",
      value: "SENTINELA-XYZ",
    };
    const error = new ValidationError("Datos inválidos", { details: [detalleConExtras] });
    const response = toErrorResponse(error, contexto);
    const texto = await response.text();
    expect(texto).not.toContain("SENTINELA");
    expect(JSON.parse(texto)).toEqual({
      error: {
        code: "validation_error",
        message: "Datos inválidos",
        details: [{ field: "email", message: "Formato inválido" }],
      },
    });
    const sinDetails = await cuerpoDe(toErrorResponse(new ConflictError("x"), contexto));
    expect(sinDetails).toEqual({ error: { code: "conflict", message: "x" } });
  });

  test("la cause de un error tipado no sale en la respuesta", async () => {
    const error = new NotFoundError("No existe", { cause: new Error("SENTINELA-XYZ") });
    const texto = await toErrorResponse(error, contexto).text();
    expect(texto).not.toContain("SENTINELA");
    expect(texto).not.toContain("cause");
  });
});

describe("toErrorResponse con errores inesperados", () => {
  test("un error inesperado responde 500 internal_error genérico", async () => {
    const error = new Error("SENTINELA-XYZ", { cause: new Error("SENTINELA-XYZ") });
    const response = toErrorResponse(error, contexto);
    expect(response.status).toBe(500);
    const texto = await response.text();
    expect(JSON.parse(texto)).toEqual(GENERICO);
    for (const prohibido of ["SENTINELA", "stack", "at ", "cause"]) {
      expect(texto).not.toContain(prohibido);
    }
  });

  test("InternalError explícito se trata como inesperado", async () => {
    const error = new InternalError("SENTINELA-XYZ detalle interno", { code: "otro_codigo" });
    const response = toErrorResponse(error, contexto);
    expect(response.status).toBe(500);
    expect(await cuerpoDe(response)).toEqual(GENERICO);
    expect(consola).toHaveBeenCalledTimes(1);
  });

  test("los valores lanzados que no son Error responden 500 genérico", async () => {
    const valores: unknown[] = [
      "texto SENTINELA-XYZ",
      null,
      undefined,
      42,
      { status: 404, code: "no_confiar" },
    ];
    for (const valor of valores) {
      consola.mockClear();
      const response = toErrorResponse(valor, contexto);
      expect(response.status).toBe(500);
      expect(await cuerpoDe(response)).toEqual(GENERICO);
      expect(JSON.stringify(registro())).not.toContain("SENTINELA");
    }
  });
});

describe("registro de errores inesperados", () => {
  test("registra una sola línea JSON controlada", () => {
    const error = new Error("SENTINELA-XYZ", { cause: new Error("SENTINELA-XYZ") });
    toErrorResponse(error, contexto);
    const linea = registro();
    expect(Object.keys(linea).sort()).toEqual(["errorName", "event", "method", "path", "time"]);
    expect(linea.event).toBe("unexpected_error");
    expect(linea.errorName).toBe("Error");
    expect(linea.method).toBe("GET");
    expect(linea.path).toBe("/api/v1/ejemplo");
    expect(Number.isNaN(Date.parse(String(linea.time)))).toBe(false);
    const texto = JSON.stringify(linea);
    for (const prohibido of ["SENTINELA", "stack", "cause", "message"]) {
      expect(texto).not.toContain(prohibido);
    }
  });

  test("el log usa solo el pathname", () => {
    toErrorResponse(new Error("x"), { method: "GET", path: "/api/v1/x?token=SENTINELA-XYZ#frag" });
    const linea = registro();
    expect(linea.path).toBe("/api/v1/x");
    const texto = JSON.stringify(linea);
    expect(texto).not.toContain("SENTINELA");
    expect(texto).not.toContain("?");
    expect(texto).not.toContain("#");
  });

  test("errorName y errorCode solo con formato seguro", () => {
    const raro = new Error("x");
    raro.name = "Raro con espacios SENTINELA";
    toErrorResponse(raro, contexto);
    expect(registro().errorName).toBe("Error");

    consola.mockClear();
    const conCodigo = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    toErrorResponse(conCodigo, contexto);
    expect(registro().errorCode).toBe("ECONNREFUSED");

    consola.mockClear();
    const codigoPeligroso = Object.assign(new Error("x"), { code: "con SENTINELA" });
    toErrorResponse(codigoPeligroso, contexto);
    const linea = registro();
    expect(linea.errorCode).toBeUndefined();
    expect(JSON.stringify(linea)).not.toContain("SENTINELA");

    consola.mockClear();
    toErrorResponse("texto", contexto);
    expect(registro().errorName).toBe("NonError");
  });

  test("frames solo con includeFrames, saneados y como máximo cinco", () => {
    const error = new Error("mensaje SENTINELA-XYZ\n    at SENTINELA (/etc/passwd:1:1)");

    toErrorResponse(error, contexto);
    expect(registro().frames).toBeUndefined();

    consola.mockClear();
    toErrorResponse(error, { ...contexto, includeFrames: true });
    const linea = registro();
    const frames = (linea.frames ?? []) as string[];
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(5);
    expect(frames.some((frame) => frame.includes("tests/unit/error-response.test.ts"))).toBe(true);
    const texto = JSON.stringify(linea);
    for (const prohibido of [
      "SENTINELA",
      "/etc/passwd",
      "?",
      "\\\\",
      "file:",
      "C:",
      "E:",
      "Users",
    ]) {
      expect(texto).not.toContain(prohibido);
    }
    for (const frame of frames) {
      expect(frame).toMatch(/^(\S+ \()?[\w$./@\-[\]+]+:\d+:\d+\)?$/);
    }
  });

  test("los errores tipados no se registran", () => {
    toErrorResponse(new ConflictError("x"), contexto);
    toErrorResponse(new ValidationError("x"), contexto);
    expect(consola).not.toHaveBeenCalled();
  });
});
