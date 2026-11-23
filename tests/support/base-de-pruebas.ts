import type { SQL } from "bun";
import { abrirBase } from "../../src/db/conexion";

const BASE_DE_PRUEBAS = "traveltech_test";

/** Conecta a `TEST_DATABASE_URL`; `undefined` si no está configurada. */
export function abrirBaseDePruebas() {
  const url = process.env.TEST_DATABASE_URL;
  return url ? abrirBase(url) : undefined;
}

/**
 * Falla si la conexión NO es a `traveltech_test`. Se comprueba el nombre real en la propia
 * conexión (comparar URLs es frágil). Llamarla antes de cualquier operación destructiva.
 */
export async function asegurarBaseDePruebas(sql: SQL): Promise<void> {
  const [fila] = await sql`select current_database() as db`;
  if (fila?.db !== BASE_DE_PRUEBAS) {
    throw new Error(`Operación destructiva rechazada: la base no es «${BASE_DE_PRUEBAS}».`);
  }
}

/** Deja `traveltech_test` sin tablas ni historial de migraciones. */
export async function recrearEsquema(sql: SQL): Promise<void> {
  await asegurarBaseDePruebas(sql);
  await sql.unsafe(
    "drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;",
  );
}
