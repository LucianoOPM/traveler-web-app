import { ForbiddenError, UnauthenticatedError } from "./errors";

/** Guardia de handlers: sin sesión → 401; vetado o sin rol `admin` → 403. Nunca confía en el cliente. */
export function exigirAdmin(locals: Pick<App.Locals, "user">) {
  const { user } = locals;
  if (!user) throw new UnauthenticatedError("Se requiere iniciar sesión");
  if (user.banned || !(user.role ?? "").split(",").includes("admin")) {
    throw new ForbiddenError("No tienes permiso para esta operación");
  }
}
