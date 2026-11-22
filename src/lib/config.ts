import path from "node:path";
import { z } from "astro/zod";

/**
 * Configuración de la aplicación. Esta función es pura: recibe un objeto con
 * variables de entorno ya leídas y devuelve la configuración validada.
 * No importa nada de `astro:*` para poder probarse con `bun test`.
 *
 * Los mensajes de error nombran la variable y la regla incumplida; nunca
 * incluyen el valor recibido (pueden ser secretos).
 */

export type Config = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  demoDatabaseUrl: string;
  authSecret: string;
  appOrigin: string;
  privateStorageDir: string;
  demoStorageDir: string;
  agencyTimezone: string;
};

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Configuración inválida:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export type LoadConfigOptions = { projectRoot?: string };

const AUTH_SECRET_MIN_LENGTH = 32;
const AUTH_SECRET_PLACEHOLDERS = ["GENERATE_A_LONG_RANDOM_SECRET", "CHANGE_ME"];
const REQUIRED = { error: "es obligatoria" };

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function postgresDatabaseName(value: string): string | null {
  const url = parseUrl(value);
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol)) return null;
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return null; // % mal codificado: se reporta como regla incumplida de la variable
  }
  return name.length > 0 ? name : null;
}

// Zonas canónicas IANA ("Region/Ciudad") más "UTC". `Intl.DateTimeFormat` por sí solo
// acepta también offsets ("+03:00"), abreviaturas ("EST") y minúsculas, y PostgreSQL
// interpreta los offsets numéricos con el signo POSIX invertido.
const IANA_TIME_ZONES = new Set<string>([...Intl.supportedValuesOf("timeZone"), "UTC"]);

function isIanaTimeZone(value: string): boolean {
  return IANA_TIME_ZONES.has(value);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  const escapes = relative === ".." || relative.startsWith(`..${path.sep}`);
  return relative === "" || (!escapes && !path.isAbsolute(relative));
}

function storageProblem(resolved: string, root: string): string | null {
  if (isInside(path.join(root, "public"), resolved)) {
    return "no puede estar dentro de public/";
  }
  if (isInside(path.join(root, "storage"), resolved)) return null;
  if (isInside(root, resolved)) {
    return "dentro del repositorio debe estar bajo storage/";
  }
  if (isInside(resolved, root)) {
    return "no puede contener al repositorio";
  }
  return null;
}

function buildSchema(root: string) {
  const postgresUrl = z
    .string(REQUIRED)
    .refine((value) => postgresDatabaseName(value) !== null, {
      error: "debe ser una URL postgres:// o postgresql:// con nombre de base",
    });

  const storageDir = z
    .string(REQUIRED)
    .min(1, { error: "no puede estar vacía" })
    .transform((value) => path.resolve(root, value))
    .refine((resolved) => storageProblem(resolved, root) === null, {
      error: "debe estar bajo storage/ o fuera del repositorio, y nunca en public/",
    });

  return z
    .object({
      NODE_ENV: z.enum(["development", "test", "production"], {
        error: "debe ser development, test o production",
      }),
      DATABASE_URL: postgresUrl,
      DEMO_DATABASE_URL: postgresUrl,
      AUTH_SECRET: z
        .string(REQUIRED)
        .min(AUTH_SECRET_MIN_LENGTH, {
          error: `debe tener al menos ${AUTH_SECRET_MIN_LENGTH} caracteres`,
        })
        .refine((value) => !AUTH_SECRET_PLACEHOLDERS.includes(value), {
          error: "no puede ser un valor de ejemplo",
        }),
      APP_ORIGIN: z
        .string(REQUIRED)
        .refine(
          (value) => {
            const url = parseUrl(value);
            return (
              url !== null &&
              ["http:", "https:"].includes(url.protocol) &&
              url.pathname === "/" &&
              url.search === "" &&
              url.hash === "" &&
              url.username === ""
            );
          },
          { error: "debe ser un origen http(s) sin ruta, parámetros ni credenciales" },
        )
        .transform((value) => new URL(value).origin),
      PRIVATE_STORAGE_DIR: storageDir,
      DEMO_STORAGE_DIR: storageDir,
      AGENCY_TIMEZONE: z.string(REQUIRED).refine(isIanaTimeZone, {
        error: "debe ser una zona horaria IANA válida",
      }),
    })
    .superRefine((data, ctx) => {
      if (postgresDatabaseName(data.DATABASE_URL) === postgresDatabaseName(data.DEMO_DATABASE_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["DEMO_DATABASE_URL"],
          message: "debe usar una base distinta de DATABASE_URL",
        });
      }
      const priv = data.PRIVATE_STORAGE_DIR;
      const demo = data.DEMO_STORAGE_DIR;
      if (isInside(priv, demo) || isInside(demo, priv)) {
        ctx.addIssue({
          code: "custom",
          path: ["DEMO_STORAGE_DIR"],
          message: "no puede ser igual ni estar anidada con PRIVATE_STORAGE_DIR",
        });
      }
    });
}

export function loadConfig(
  raw: Record<string, string | undefined>,
  options: LoadConfigOptions = {},
): Config {
  const root = path.resolve(options.projectRoot ?? process.cwd());
  const result = buildSchema(root).safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${String(issue.path[0] ?? "(configuración)")}: ${issue.message}`,
    );
    throw new ConfigError(issues);
  }

  const data = result.data;
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    demoDatabaseUrl: data.DEMO_DATABASE_URL,
    authSecret: data.AUTH_SECRET,
    appOrigin: data.APP_ORIGIN,
    privateStorageDir: data.PRIVATE_STORAGE_DIR,
    demoStorageDir: data.DEMO_STORAGE_DIR,
    agencyTimezone: data.AGENCY_TIMEZONE,
  };
}
