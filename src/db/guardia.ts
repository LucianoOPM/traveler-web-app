/**
 * Guardia de base de pruebas (PEN-15). Toda operación destructiva de pruebas o de rollback debe
 * llamarla ANTES de ejecutar SQL: comprueba el nombre real de la base en la propia conexión
 * (`current_database()`), porque comparar URLs es frágil (localhost frente a 127.0.0.1, otro
 * usuario, parámetros).
 */
export const BASE_DE_PRUEBAS = "traveltech_test";

export type ConsultaSql = (
  strings: TemplateStringsArray,
  ...valores: unknown[]
) => PromiseLike<Array<Record<string, unknown>>>;

export class GuardiaBaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GuardiaBaseError";
  }
}

export async function asegurarBaseDePruebas(sql: ConsultaSql): Promise<void> {
  let filas: Array<Record<string, unknown>>;
  try {
    filas = await sql`select current_database() as db`;
  } catch (cause) {
    throw new GuardiaBaseError("No se pudo comprobar el nombre de la base de datos.", { cause });
  }
  const nombre = filas[0]?.db;
  if (nombre !== BASE_DE_PRUEBAS) {
    const visto = typeof nombre === "string" && nombre !== "" ? nombre : "desconocida";
    throw new GuardiaBaseError(
      `Operación destructiva rechazada: la base conectada es «${visto}», no «${BASE_DE_PRUEBAS}».`,
    );
  }
}
