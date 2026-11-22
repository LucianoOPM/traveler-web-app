import type { APIRoute } from "astro";
import { ValidationError } from "../../../../../../src/lib/errors";

export const GET: APIRoute = () => {
  throw new ValidationError("Datos inválidos", {
    details: [{ field: "email", message: "Formato inválido" }],
  });
};
