// Traduce el error de una Action a lo que pinta el formulario. Pura (sin `astro:actions`) para poder
// probarla con Bun: el componente decide `entradaInvalida` con `isInputError(error)`.
export type ErrorDeAccion = { message: string; fields?: Record<string, string[] | undefined> };

export const MENSAJE_ENTRADA_INVALIDA = "Revisa los datos enviados.";

export function erroresDeAccion(error: ErrorDeAccion, entradaInvalida: boolean) {
  const campos: Record<string, string> = {};
  for (const [nombre, mensajes] of Object.entries(error.fields ?? {})) {
    if (mensajes?.length) campos[nombre] = mensajes.join(", ");
  }
  if (Object.keys(campos).length > 0) return { campos, general: null };
  // Sin campos (p. ej. clave desconocida): mensaje fijo; el texto interno de Zod no se muestra.
  return { campos, general: entradaInvalida ? MENSAJE_ENTRADA_INVALIDA : error.message };
}
