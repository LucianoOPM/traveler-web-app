import type { APIRoute } from "astro";
import { auth } from "../../../modules/identity/auth";

export const ALL: APIRoute = ({ request, clientAddress }) => {
  // El límite de intentos de Better Auth usa `x-forwarded-for`. Nunca se confía en el del cliente:
  // se descarta y se sustituye por `clientAddress`, que Astro toma del socket (solo lee
  // `x-forwarded-for` con `security.allowedDomains`, que este proyecto no configura).
  // Sin IP, Better Auth usa un único cubo compartido por ruta: sigue limitando.
  const headers = new Headers(request.headers);
  headers.delete("x-forwarded-for");
  if (clientAddress) headers.set("x-forwarded-for", clientAddress);
  return auth.handler(new Request(request, { headers }));
};
