import { defineMiddleware } from "astro:middleware";
import { getConfig } from "./lib/config.runtime";
import { toErrorResponse } from "./lib/error-response";

function esRutaApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

// Convierte en una respuesta uniforme cualquier error lanzado por los endpoints de `/api/`
// (`next()` rechaza con el valor lanzado original; verificado con un servidor Astro real).
// Fuera de `/api/` se relanza para conservar el manejo de errores de Astro.
//
// `getConfig()` es una defensa adicional: la validación principal ocurre al arrancar
// (astro.config.mjs en dev/build y scripts/start.ts en producción).
export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  try {
    getConfig();
    return await next();
  } catch (error) {
    if (!esRutaApi(pathname)) throw error;
    return toErrorResponse(error, {
      method: context.request.method,
      path: pathname,
      includeFrames: import.meta.env.DEV,
    });
  }
});
