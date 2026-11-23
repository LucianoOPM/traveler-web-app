/**
 * Errores tipados de la aplicación. Cualquier código que se ejecute en un endpoint
 * puede lanzarlos; `src/middleware.ts` los convierte en una respuesta HTTP uniforme
 * (ver `./error-response`).
 *
 * IMPORTANTE: el `message` de un AppError (salvo InternalError) se devuelve al cliente
 * tal cual. Debe ser público y seguro: sin valores proporcionados por el usuario, sin
 * datos técnicos, rutas internas ni credenciales. Los detalles técnicos van en `cause`,
 * que nunca se serializa.
 */

export type ErrorDetail = { field: string; message: string };

export type AppErrorOptions = {
  /** Código estable en snake_case (p. ej. `capacity_exceeded`). Por defecto, el de la clase. */
  code?: string;
  /** Causa técnica; nunca sale en la respuesta ni en el registro. */
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    options: AppErrorOptions = {},
    defaults: { status: number; code: string } = { status: 500, code: "internal_error" },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = defaults.status;
    this.code = options.code ?? defaults.code;
  }
}

export class ValidationError extends AppError {
  readonly details?: ErrorDetail[];

  constructor(message: string, options: AppErrorOptions & { details?: ErrorDetail[] } = {}) {
    super(message, options, { status: 400, code: "validation_error" });
    this.details = options.details;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options, { status: 401, code: "unauthenticated" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options, { status: 403, code: "forbidden" });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options, { status: 404, code: "not_found" });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options, { status: 409, code: "conflict" });
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options, { status: 422, code: "business_rule_violation" });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options, { status: 429, code: "rate_limited" });
  }
}

/** Fallo interno explícito. Su mensaje nunca se expone: la respuesta es genérica. */
export class InternalError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options, { status: 500, code: "internal_error" });
  }
}
