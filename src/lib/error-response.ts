/**
 * Convierte un error en una respuesta HTTP uniforme `{ error: { code, message } }`.
 *
 * - Un `AppError` (salvo `InternalError`) se devuelve tal cual: su `message` es público.
 * - Cualquier otro valor lanzado es inesperado: responde un 500 genérico y se registra solo
 *   el nombre del error, el método y la ruta (sin mensaje, `cause`, query ni cabeceras).
 *   En desarrollo (`detallado`) se imprime el error completo para poder depurarlo.
 */
import { AppError, ValidationError } from "./errors";

export const INTERNAL_ERROR_MESSAGE = "Error interno del servidor";

export type ErrorContext = { method: string; path: string; detallado?: boolean };

export function toErrorResponse(error: unknown, { method, path, detallado }: ErrorContext) {
  if (error instanceof AppError && error.status !== 500) {
    const cuerpo: Record<string, unknown> = { code: error.code, message: error.message };
    if (error instanceof ValidationError && error.details) cuerpo.details = error.details;
    return Response.json({ error: cuerpo }, { status: error.status });
  }

  if (detallado) {
    console.error(error);
  } else {
    const errorName = error instanceof Error ? error.name : "NonError";
    console.error(JSON.stringify({ event: "unexpected_error", errorName, method, path }));
  }
  return Response.json(
    { error: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE } },
    { status: 500 },
  );
}
