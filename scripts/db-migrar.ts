/**
 * Aplica las migraciones a la base privada (por defecto) o a la demo.
 * Uso: `bun run db:migrate [private|demo]`. La URL sale de la configuración validada
 * (`loadConfig`); nunca se imprime. `traveltech_test` queda reservada a las pruebas.
 * Salida: 0 correcto, 1 configuración o migración fallida, 2 uso incorrecto.
 */
import { abrirBase } from "../src/db/conexion";
import { migrar } from "../src/db/migrar";
import { ObjetivoInvalidoError, parsearObjetivo, urlDelObjetivo } from "../src/db/objetivo";
import { ConfigError, loadConfig } from "../src/lib/config";

let objetivo;
try {
  objetivo = parsearObjetivo(process.argv.slice(2));
} catch (error) {
  if (error instanceof ObjetivoInvalidoError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const { sql, db } = abrirBase(urlDelObjetivo(config, objetivo));
try {
  const total = await migrar(db);
  console.log(
    total === 0
      ? "No hay migraciones que aplicar."
      : `Migraciones aplicadas a la base ${objetivo}.`,
  );
} catch {
  // No se imprime el error original: puede incluir datos de conexión.
  console.error(`No se pudieron aplicar las migraciones a la base ${objetivo}.`);
  process.exitCode = 1;
} finally {
  await sql.close();
}
