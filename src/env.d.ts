declare namespace App {
  // Solo se rellenan en las rutas protegidas (`/admin`); en el resto quedan sin definir.
  interface Locals {
    user?: import("./modules/identity/auth").Sesion["user"] | null;
    session?: import("./modules/identity/auth").Sesion["session"] | null;
  }
}
