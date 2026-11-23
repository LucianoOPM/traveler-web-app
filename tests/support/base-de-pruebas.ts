import type { SQL } from "bun";
import { abrirBase } from "../../src/db/conexion";
import { asegurarBaseDePruebas } from "../../src/db/guardia";

/** URL de la base de pruebas (`TEST_DATABASE_URL`); `undefined` si no está configurada. */
export function urlDePruebas(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  return url === undefined || url === "" ? undefined : url;
}

/** Abre la conexión de pruebas y comprueba, en la propia conexión, que es `traveltech_test`. */
export async function abrirBaseDePruebas(): Promise<ReturnType<typeof abrirBase>> {
  const url = urlDePruebas();
  if (url === undefined) throw new Error("TEST_DATABASE_URL no está configurada.");
  const base = abrirBase(url);
  try {
    await asegurarBaseDePruebas(base.sql);
  } catch (error) {
    await base.sql.close();
    throw error;
  }
  return base;
}

/** Deja la base de pruebas sin tablas ni historial de migraciones. Destructivo: la guardia va primero. */
export async function reiniciarEsquema(sql: SQL): Promise<void> {
  await asegurarBaseDePruebas(sql);
  await sql.unsafe(
    "drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;",
  );
}
