/** SQLSTATE del error. Bun lo expone en `errno` y Drizzle puede envolverlo en `cause`. */
export function esErrorPg(error: unknown, sqlstate: "23503" | "23505"): boolean {
  type Anidado = { errno?: unknown; code?: unknown; cause?: unknown };
  let actual = error as Anidado | undefined;
  for (let i = 0; actual && i < 3; i++) {
    if (actual.errno === sqlstate || actual.code === sqlstate) return true;
    actual = actual.cause as Anidado | undefined;
  }
  return false;
}
