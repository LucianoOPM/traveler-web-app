import path from "node:path";

/**
 * Comprueba las variables de entorno obligatorias. Devuelve la lista de problemas (vacía si todo
 * está bien). Los mensajes nombran la variable y la regla, nunca el valor (pueden ser secretos).
 * La usan `astro.config.mjs` (dev y build) y `scripts/start.ts` (producción).
 */
const OBLIGATORIAS = [
  "DATABASE_URL",
  "DEMO_DATABASE_URL",
  "AUTH_SECRET",
  "APP_ORIGIN",
  "PRIVATE_STORAGE_DIR",
  "DEMO_STORAGE_DIR",
  "AGENCY_TIMEZONE",
];
const AUTH_SECRET_PLACEHOLDERS = ["GENERATE_A_LONG_RANDOM_SECRET", "CHANGE_ME"];

function nombreDeBase(url: string | undefined): string | undefined {
  try {
    const { protocol, pathname } = new URL(url ?? "");
    if (protocol !== "postgres:" && protocol !== "postgresql:") return undefined;
    return pathname.replace(/^\//, "") || undefined;
  } catch {
    return undefined;
  }
}

function dentroDe(carpeta: string, ruta: string): boolean {
  const relativa = path.relative(carpeta, ruta);
  return relativa === "" || (!relativa.startsWith("..") && !path.isAbsolute(relativa));
}

export function comprobarConfiguracion(
  env: Record<string, string | undefined>,
  raiz: string = process.cwd(),
): string[] {
  const problemas: string[] = [];
  const faltan = OBLIGATORIAS.filter((nombre) => !env[nombre]);
  for (const nombre of faltan) problemas.push(`${nombre}: es obligatoria`);
  const presente = (nombre: string) => !faltan.includes(nombre);

  const privada = nombreDeBase(env.DATABASE_URL);
  const demo = nombreDeBase(env.DEMO_DATABASE_URL);
  if (presente("DATABASE_URL") && privada === undefined) {
    problemas.push("DATABASE_URL: debe ser una URL postgres:// con nombre de base");
  }
  if (presente("DEMO_DATABASE_URL") && demo === undefined) {
    problemas.push("DEMO_DATABASE_URL: debe ser una URL postgres:// con nombre de base");
  }
  if (privada !== undefined && privada === demo) {
    problemas.push("DEMO_DATABASE_URL: debe usar una base distinta de DATABASE_URL");
  }

  const secreto = env.AUTH_SECRET ?? "";
  if (presente("AUTH_SECRET") && secreto.length < 32) {
    problemas.push("AUTH_SECRET: debe tener al menos 32 caracteres");
  } else if (AUTH_SECRET_PLACEHOLDERS.includes(secreto)) {
    problemas.push("AUTH_SECRET: no puede ser un valor de ejemplo");
  }

  if (presente("APP_ORIGIN") && !/^https?:$/.test(URL.parse(env.APP_ORIGIN!)?.protocol ?? "")) {
    problemas.push("APP_ORIGIN: debe ser una URL http(s)");
  }

  // Zona IANA exacta: `Intl` acepta también offsets, que PostgreSQL interpreta con signo invertido.
  const zona = env.AGENCY_TIMEZONE ?? "";
  if (
    presente("AGENCY_TIMEZONE") &&
    zona !== "UTC" &&
    !Intl.supportedValuesOf("timeZone").includes(zona)
  ) {
    problemas.push(
      "AGENCY_TIMEZONE: debe ser una zona horaria IANA válida (p. ej. America/Mexico_City)",
    );
  }

  if (presente("PRIVATE_STORAGE_DIR") && presente("DEMO_STORAGE_DIR")) {
    const privado = path.resolve(raiz, env.PRIVATE_STORAGE_DIR!);
    const demoDir = path.resolve(raiz, env.DEMO_STORAGE_DIR!);
    for (const [nombre, carpeta] of [
      ["PRIVATE_STORAGE_DIR", privado],
      ["DEMO_STORAGE_DIR", demoDir],
    ] as const) {
      if (dentroDe(path.join(raiz, "public"), carpeta)) {
        problemas.push(`${nombre}: no puede estar dentro de public/`);
      }
    }
    if (dentroDe(privado, demoDir) || dentroDe(demoDir, privado)) {
      problemas.push(
        "DEMO_STORAGE_DIR: no puede ser igual ni estar anidada con PRIVATE_STORAGE_DIR",
      );
    }
  }

  return problemas;
}
