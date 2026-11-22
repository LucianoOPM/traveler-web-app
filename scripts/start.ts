/**
 * Arranque de producción: valida la configuración ANTES de levantar el
 * servidor. Con configuración inválida termina con código 1 y no escucha en
 * ningún puerto. Solo imprime nombres de variable y reglas, nunca valores.
 *
 * Uso: `bun run start` (después de `bun run build`).
 * Bun carga `.env` automáticamente; las variables reales del entorno tienen
 * prioridad sobre el archivo.
 */
import { ConfigError, loadConfig } from "../src/lib/config";

try {
  loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const entry = new URL("../dist/server/entry.mjs", import.meta.url).href;
await import(entry);
