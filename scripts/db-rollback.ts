/**
 * Revierte la última migración aplicada, SOLO en la base de pruebas (`TEST_DATABASE_URL`).
 * La guardia comprueba `current_database()` en la conexión antes de ejecutar cualquier SQL: con
 * `traveltech_private`, `traveltech_demo` u otro nombre se rechaza. La URL nunca se imprime.
 * Para otras bases, la reversión es manual (ADR-023). Salida: 0 correcto, 1 rechazado o fallido,
 * 2 uso incorrecto o falta `TEST_DATABASE_URL`.
 */
import { abrirBase } from "../src/db/conexion";
import { GuardiaBaseError } from "../src/db/guardia";
import { RollbackError, revertirUltimaMigracion } from "../src/db/rollback";

if (process.argv.length > 2) {
  console.error("Uso: bun run db:rollback (sin argumentos; opera solo sobre TEST_DATABASE_URL)");
  process.exit(2);
}
const url = process.env.TEST_DATABASE_URL;
if (url === undefined || url === "") {
  console.error(
    "TEST_DATABASE_URL no está configurada: db:rollback solo opera sobre la base de pruebas.",
  );
  process.exit(2);
}

const { sql } = abrirBase(url);
try {
  const { tag } = await revertirUltimaMigracion(sql);
  console.log(`Revertida ${tag} en la base de pruebas.`);
} catch (error) {
  if (error instanceof GuardiaBaseError || error instanceof RollbackError) {
    console.error(error.message);
  } else {
    // No se imprime el error original: puede incluir datos de conexión.
    console.error("No se pudo revertir la migración.");
  }
  process.exitCode = 1;
} finally {
  await sql.close();
}
