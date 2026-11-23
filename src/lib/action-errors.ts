/**
 * Adaptador `AppError` → datos de `ActionError` (ADR-025). Astro devolvería al cliente el mensaje de
 * cualquier error inesperado de un handler; aquí solo salen los mensajes públicos de un `AppError`.
 * Es una función pura (sin `astro:actions`) para poder probarla con Bun.
 */
import { AppError } from "./errors";
import { INTERNAL_ERROR_MESSAGE } from "./error-response";

export type ActionErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_CONTENT"
  | "INTERNAL_SERVER_ERROR";

const POR_ESTADO: Record<number, ActionErrorCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_CONTENT",
};

export function toActionErrorData(
  error: unknown,
  { action, detallado }: { action: string; detallado?: boolean },
): { code: ActionErrorCode; message: string } {
  if (error instanceof AppError && POR_ESTADO[error.status]) {
    return { code: POR_ESTADO[error.status]!, message: error.message };
  }
  if (detallado) {
    console.error(error);
  } else {
    const errorName = error instanceof Error ? error.name : "NonError";
    console.error(JSON.stringify({ event: "unexpected_error", errorName, action }));
  }
  return { code: "INTERNAL_SERVER_ERROR", message: INTERNAL_ERROR_MESSAGE };
}
