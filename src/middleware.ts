import { defineMiddleware } from "astro:middleware";
import { toErrorResponse } from "@lib/error-response";
import { esAdmin } from "@lib/guards";

// Convierte en una respuesta uniforme cualquier error lanzado por los endpoints de `/api/`.
// Fuera de `/api/` se relanza para conservar el manejo de errores de Astro.
export const onRequest = defineMiddleware(async (context, next) => {
  try {
    // La sesión solo se resuelve donde hace falta. `auth` se importa aquí y no arriba: así las demás
    // rutas (p. ej. `/api/health`) no cargan Better Auth ni necesitan la base de datos.
    const ruta = context.url.pathname;
    const enAdmin = ruta === "/admin" || ruta.startsWith("/admin/");
    // En `/_actions/` y `/api/media/` solo se resuelve la sesión: el permiso lo comprueba cada handler (ADR-025).
    // `/api/media/` la necesita para que el admin vea las imágenes de borradores.
    if (
      enAdmin ||
      ruta === "/login" ||
      ruta.startsWith("/_actions/") ||
      ruta.startsWith("/api/media/")
    ) {
      const { auth, roles } = await import("@modules/identity/auth");
      const sesion = await auth.api.getSession({ headers: context.request.headers });
      context.locals.user = sesion?.user ?? null;
      context.locals.session = sesion?.session ?? null;

      if (enAdmin) {
        // Solo personal (`admin` u `operator`, también si el usuario tiene varios roles separados
        // por coma) y no vetado. Los permisos por operación se validan en cada endpoint; el
        // catálogo (CRUD de paquetes y salidas) es solo de `admin`: el operador no lo ve.
        const { user } = context.locals;
        const esPersonal = (user?.role ?? "").split(",").some((rol) => Object.hasOwn(roles, rol));
        const esCatalogo = ruta === "/admin/catalogo" || ruta.startsWith("/admin/catalogo/");
        const respuesta = !user
          ? context.redirect("/login")
          : user.banned || !esPersonal || (esCatalogo && !esAdmin(user))
            ? new Response("Prohibido", { status: 403 })
            : await next();
        respuesta.headers.set("Cache-Control", "no-store");
        return respuesta;
      }
    }
    // La consulta de reserva lleva el token en la URL: nunca se cachea ni se envía como referrer.
    if (ruta.startsWith("/reservas/")) {
      const respuesta = await next();
      respuesta.headers.set("Cache-Control", "no-store");
      respuesta.headers.set("Referrer-Policy", "no-referrer");
      return respuesta;
    }
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
