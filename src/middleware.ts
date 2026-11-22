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
  // Los frames del registro dependen del entorno de EJECUCIÓN validado (NODE_ENV de la
  // configuración), no del entorno del build: un build hecho con NODE_ENV=test no debe
  // publicar frames en producción. Ante cualquier duda (p. ej. configuración inválida), sin frames.
  let includeFrames = false;
  try {
    includeFrames = getConfig().nodeEnv !== "production";
    return await next();
  } catch (error) {
    if (!esRutaApi(pathname)) throw error;
    return toErrorResponse(error, {
      method: context.request.method,
      path: pathname,
      includeFrames,
    });
  }
});
