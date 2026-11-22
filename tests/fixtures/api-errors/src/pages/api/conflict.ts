import type { APIRoute } from "astro";
import { ConflictError } from "../../../../../../src/lib/errors";

export const GET: APIRoute = () => {
  throw new ConflictError("No hay capacidad disponible", { code: "capacity_exceeded" });
};
