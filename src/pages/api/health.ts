import type { APIRoute } from "astro";

// Prueba de salud local. Sin efectos secundarios (GET nunca muta) y sin exponer configuración,
// versiones ni datos internos. Que responda "ok" implica que el servidor arrancó con una
// configuración válida: el middleware la valida en cada petición y, si es inválida, esta ruta
// responde `500 internal_error` en lugar de "ok". No comprueba la base de datos (aún no existe).
export const GET: APIRoute = () =>
  Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
