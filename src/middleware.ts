import { defineMiddleware } from "astro:middleware";
import { toErrorResponse } from "./lib/error-response";

// Convierte en una respuesta uniforme cualquier error lanzado por los endpoints de `/api/`.
// Fuera de `/api/` se relanza para conservar el manejo de errores de Astro.
export const onRequest = defineMiddleware(async (context, next) => {
  try {
    return await next();
  } catch (error) {
    const path = context.url.pathname;
    if (path !== "/api" && !path.startsWith("/api/")) throw error;
    return toErrorResponse(error, {
      method: context.request.method,
      path,
      // Se lee en ejecución, no en el build: un build hecho con otro NODE_ENV no cambia nada.
      detallado: process.env.NODE_ENV === "development",
    });
  }
});
