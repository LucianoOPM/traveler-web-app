import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { CARPETA_MIGRACIONES, leerJournal } from "./migraciones";

/**
 * Aplica las migraciones pendientes con el migrador programático de `bun-sql` (Bun carga `.env`;
 * `drizzle-kit migrate` corre bajo Node y no, ADR-023). Devuelve cuántas migraciones tiene el
 * journal; con `0` no toca la base.
 */
export async function migrar(
  db: BunSQLDatabase<Record<string, unknown>>,
  carpeta: string = CARPETA_MIGRACIONES,
): Promise<number> {
  const total = leerJournal(carpeta).length;
  if (total === 0) return 0;
  await migrate(db, { migrationsFolder: carpeta });
  return total;
}
