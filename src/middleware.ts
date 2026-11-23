import { defineMiddleware } from "astro:middleware";
import { toErrorResponse } from "./lib/error-response";

// Convierte en una respuesta uniforme cualquier error lanzado por los endpoints de `/api/`.
// Fuera de `/api/` se relanza para conservar el manejo de errores de Astro.
export const onRequest = defineMiddleware(async (context, next) => {
  try {
    // La sesión solo se resuelve donde hace falta. `auth` se importa aquí y no arriba: así las demás
    // rutas (p. ej. `/api/health`) no cargan Better Auth ni necesitan la base de datos.
    const ruta = context.url.pathname;
    const esAdmin = ruta === "/admin" || ruta.startsWith("/admin/");
    if (esAdmin || ruta === "/login") {
      const { auth, roles } = await import("./modules/identity/auth");
      const sesion = await auth.api.getSession({ headers: context.request.headers });
      context.locals.user = sesion?.user ?? null;
      context.locals.session = sesion?.session ?? null;

      if (esAdmin) {
        // Solo personal (`admin` u `operator`, también si el usuario tiene varios roles separados
        // por coma) y no vetado. Los permisos por operación se validan en cada endpoint.
        const { user } = context.locals;
        const esPersonal = (user?.role ?? "").split(",").some((rol) => Object.hasOwn(roles, rol));
        const respuesta = !user
          ? context.redirect("/login")
          : user.banned || !esPersonal
            ? new Response("Prohibido", { status: 403 })
            : await next();
        respuesta.headers.set("Cache-Control", "no-store");
        return respuesta;
      }
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
