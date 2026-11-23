import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { comprobarConfiguracion } from "../../src/lib/config";

const raiz = path.resolve(import.meta.dir, "../..");

const valida: Record<string, string> = {
  DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_private",
  DEMO_DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_demo",
  BETTER_AUTH_SECRET: "k8Jd-2mQ9xLp-7vRt-4nWz-1bYc-6hGf-3sAe",
  BETTER_AUTH_URL: "http://localhost:4321",
  PRIVATE_STORAGE_DIR: "./storage/private",
  DEMO_STORAGE_DIR: "./storage/demo",
  AGENCY_TIMEZONE: "America/Mexico_City",
};

const problemasCon = (cambios: Record<string, string | undefined>) =>
  comprobarConfiguracion({ ...valida, ...cambios }, raiz);

describe("comprobarConfiguracion", () => {
  test("acepta una configuración válida", () => {
    expect(problemasCon({})).toEqual([]);
  });

  test("nombra cada variable faltante", () => {
    for (const nombre of Object.keys(valida)) {
      expect(problemasCon({ [nombre]: undefined })).toContain(`${nombre}: es obligatoria`);
    }
  });

  test("rechaza una URL que no es postgres", () => {
    expect(problemasCon({ DATABASE_URL: "mysql://u:p@localhost/traveltech_private" })).toEqual([
      "DATABASE_URL: debe ser una URL postgres:// con nombre de base",
    ]);
  });

  test("rechaza la misma base para privada y demo", () => {
    expect(problemasCon({ DEMO_DATABASE_URL: valida.DATABASE_URL })).toEqual([
      "DEMO_DATABASE_URL: debe usar una base distinta de DATABASE_URL",
    ]);
  });

  test("rechaza un BETTER_AUTH_SECRET corto o de ejemplo, sin revelar su valor", () => {
    const corto = problemasCon({ BETTER_AUTH_SECRET: "corto-SECRETO" });
    expect(corto).toEqual(["BETTER_AUTH_SECRET: debe tener al menos 32 caracteres"]);
    expect(corto.join()).not.toContain("SECRETO");
    const ejemplo = problemasCon({ BETTER_AUTH_SECRET: "GENERATE_A_LONG_RANDOM_SECRET" });
    expect(ejemplo.join()).toContain("BETTER_AUTH_SECRET");
  });

  test("rechaza zonas horarias que no son IANA (offsets, abreviaturas)", () => {
    for (const zona of ["+03:00", "EST", "mexico"]) {
      expect(problemasCon({ AGENCY_TIMEZONE: zona })).toHaveLength(1);
    }
    expect(problemasCon({ AGENCY_TIMEZONE: "UTC" })).toEqual([]);
  });

  test("los archivos privados no pueden estar en public/ ni anidarse entre sí", () => {
    expect(problemasCon({ PRIVATE_STORAGE_DIR: "./public/privado" })).toHaveLength(1);
    expect(problemasCon({ DEMO_STORAGE_DIR: "./storage/private/demo" })).toHaveLength(1);
    expect(problemasCon({ DEMO_STORAGE_DIR: "./storage/private" })).toHaveLength(1);
  });

  test(".env.example es válido una vez reemplazado BETTER_AUTH_SECRET", () => {
    const env: Record<string, string> = {};
    for (const linea of readFileSync(path.join(raiz, ".env.example"), "utf8").split(/\r?\n/)) {
      const i = linea.indexOf("=");
      if (linea.startsWith("#") || i === -1) continue;
      env[linea.slice(0, i)] = linea.slice(i + 1);
    }
    expect(
      comprobarConfiguracion({ ...env, BETTER_AUTH_SECRET: valida.BETTER_AUTH_SECRET }, raiz),
    ).toEqual([]);
  });
});
