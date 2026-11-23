import type { APIRoute } from "astro";

// Prueba de salud local. Sin efectos secundarios (GET nunca muta) y sin exponer configuración,
// versiones ni datos internos. La configuración se comprueba al arrancar (`astro dev`, `astro build`
// y `bun run start`). No comprueba la base de datos (aún no existe).
export const GET: APIRoute = () =>
  Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
