import { ForbiddenError, UnauthenticatedError } from "./errors";

type Usuario = { role?: string | null; banned?: boolean | null } | null | undefined;

/** Con sesión, no vetado y con rol `admin` (también si hay varios roles separados por coma). */
export function esAdmin(user: Usuario): boolean {
  return !!user && !user.banned && (user.role ?? "").split(",").includes("admin");
}

/** Guardia de handlers: sin sesión → 401; vetado o sin rol `admin` → 403. Nunca confía en el cliente. */
export function exigirAdmin(locals: Pick<App.Locals, "user">) {
  const { user } = locals;
  if (!user) throw new UnauthenticatedError("Se requiere iniciar sesión");
  if (!esAdmin(user)) throw new ForbiddenError("No tienes permiso para esta operación");
}
