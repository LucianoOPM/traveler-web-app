import { SQL } from "bun";
import { drizzle, type BunSQLDatabase } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

/**
 * Abre una conexión a la base indicada. Sin singleton: quien la abre la cierra (`sql.close()`).
 * La URL la decide siempre el servidor (configuración); nunca el cliente.
 */
export function abrirBase(url: string): { sql: SQL; db: BunSQLDatabase<typeof schema> } {
  const sql = new SQL(url);
  return { sql, db: drizzle({ client: sql, schema }) };
}
