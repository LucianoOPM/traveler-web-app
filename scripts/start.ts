/**
 * Arranque de producción: comprueba la configuración ANTES de levantar el servidor. Con
 * configuración inválida termina con código 1 y no escucha en ningún puerto. Solo imprime
 * nombres de variable y reglas, nunca valores. Uso: `bun run start` (tras `bun run build`).
 */
import { comprobarConfiguracion } from "../src/lib/config";

const problemas = comprobarConfiguracion(process.env);
if (problemas.length > 0) {
  console.error(`Configuración inválida:\n- ${problemas.join("\n- ")}`);
  process.exit(1);
}

await import(new URL("../dist/server/entry.mjs", import.meta.url).href);
