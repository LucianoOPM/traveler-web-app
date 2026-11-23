import type { SQL } from "bun";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { asegurarBaseDePruebas } from "./guardia";
import { CARPETA_MIGRACIONES, leerJournal, motivoIrreversible, rutaDown } from "./migraciones";

export class RollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackError";
  }
}

/**
 * Revierte la última migración aplicada con su `.down.sql` (ADR-023). Solo opera sobre
 * `traveltech_test`: la guardia comprueba `current_database()` en esta conexión antes de ejecutar
 * cualquier otra sentencia. El `down` y el borrado de su fila en `drizzle.__drizzle_migrations`
 * van en una sola transacción: si el SQL falla no cambia nada.
 */
export async function revertirUltimaMigracion(
  sql: SQL,
  carpeta: string = CARPETA_MIGRACIONES,
): Promise<{ tag: string }> {
  await asegurarBaseDePruebas(sql);

  const [existe] = await sql`select to_regclass('drizzle.__drizzle_migrations') as tabla`;
  if (existe?.tabla == null) throw new RollbackError("No hay migraciones aplicadas.");
  const [ultima] = await sql`
    select id, hash, created_at from drizzle.__drizzle_migrations order by id desc limit 1`;
  if (ultima === undefined) throw new RollbackError("No hay migraciones aplicadas.");

  const entrada = leerJournal(carpeta).find((e) => e.when === Number(ultima.created_at));
  if (entrada === undefined) {
    throw new RollbackError("La última migración aplicada no está en el journal de la carpeta.");
  }
  const { tag } = entrada;

  const archivoSql = path.join(carpeta, `${tag}.sql`);
  const hashActual = existsSync(archivoSql)
    ? createHash("sha256").update(readFileSync(archivoSql, "utf8")).digest("hex")
    : null;
  if (hashActual !== ultima.hash) {
    throw new RollbackError(
      `${tag}: el archivo .sql no coincide con la migración aplicada; no se revierte.`,
    );
  }

  const archivoDown = rutaDown(carpeta, tag);
  if (!existsSync(archivoDown)) throw new RollbackError(`${tag}: falta ${tag}.down.sql.`);
  const textoDown = readFileSync(archivoDown, "utf8");
  const motivo = motivoIrreversible(textoDown);
  if (motivo !== null) throw new RollbackError(`${tag} es IRREVERSIBLE: ${motivo}`);

  await sql.begin(async (tx) => {
    await tx.unsafe(textoDown);
    await tx`delete from drizzle.__drizzle_migrations where id = ${ultima.id}`;
  });
  return { tag };
}
