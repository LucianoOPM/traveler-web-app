import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  throw new Error("SENTINELA-XYZ", { cause: new Error("SENTINELA-XYZ") });
};
