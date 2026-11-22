import { defineMiddleware } from "astro:middleware";
import { getConfig } from "./lib/config.runtime";

// Defensa adicional: la validación principal ocurre al arrancar
// (astro.config.mjs en dev/build y scripts/start.ts en producción).
export const onRequest = defineMiddleware((_context, next) => {
  getConfig();
  return next();
});
