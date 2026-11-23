import { ActionError, type ActionAPIContext } from "astro:actions";
import { toActionErrorData } from "@lib/action-errors";

/**
 * Envuelve un handler: todo `AppError` o error inesperado pasa por el adaptador y sale como
 * `ActionError` con mensaje público (ADR-025). Sin esto, Astro filtraría el mensaje original.
 */
export function conErrores<I, O>(
  nombre: string,
  handler: (input: I, contexto: ActionAPIContext) => Promise<O>,
) {
  return async (input: I, contexto: ActionAPIContext): Promise<O> => {
    try {
      return await handler(input, contexto);
    } catch (error) {
      if (error instanceof ActionError) throw error;
      // Se lee en ejecución, no en el build (igual que el middleware).
      const datos = toActionErrorData(error, {
        action: nombre,
        detallado: process.env.NODE_ENV === "development",
      });
      throw new ActionError(datos);
    }
  };
}
