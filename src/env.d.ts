declare namespace App {
  // Solo se rellenan en `/admin`, `/login` y `/_actions/`; en el resto quedan sin definir.
  interface Locals {
    user?: import("@modules/identity/auth").Sesion["user"] | null;
    session?: import("@modules/identity/auth").Sesion["session"] | null;
  }
}
