/**
 * Lectura de configuración en SERVIDOR. Importa `astro:env/server`, que Astro
 * no permite usar desde código de cliente (el build falla si se intenta).
 *
 * Se lee con `getSecret()` (no con `import.meta.env`, que incrusta los valores
 * del `.env` dentro de `dist/`). La lógica de validación vive en `./config`.
 */
import { getSecret } from "astro:env/server";
import { loadConfig, type Config } from "./config";

const KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "DEMO_DATABASE_URL",
  "AUTH_SECRET",
  "APP_ORIGIN",
  "PRIVATE_STORAGE_DIR",
  "DEMO_STORAGE_DIR",
  "AGENCY_TIMEZONE",
] as const;

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = {};
  for (const key of KEYS) raw[key] = getSecret(key);
  cached = loadConfig(raw);
  return cached;
}
