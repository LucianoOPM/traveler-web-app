import { defineMiddleware } from "astro:middleware";
import { getConfig } from "./lib/config.runtime";
import { toErrorResponse } from "./lib/error-response";

// Convierte en una respuesta uniforme cualquier error lanzado por los endpoints de `/api/`.
// Fuera de `/api/` se relanza para conservar el manejo de errores de Astro.
export const onRequest = defineMiddleware(async (context, next) => {
  try {
    getConfig(); // lanza si la configuración es inválida (p. ej. al iniciar sin `bun run start`)
    return await next();
  } catch (error) {
    const path = context.url.pathname;
    if (path !== "/api" && !path.startsWith("/api/")) throw error;
    return toErrorResponse(error, {
      method: context.request.method,
      path,
      detallado: process.env.NODE_ENV !== "production", // en ejecución, no en el build
    });
  }
});
