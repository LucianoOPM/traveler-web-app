import { describe, expect, test } from "bun:test";
import path from "node:path";
import { ConfigError, loadConfig } from "../../src/lib/config";

const projectRoot = path.resolve("/tmp/traveltech-proyecto-prueba");
const fueraDelRepo = path.resolve("/tmp/traveltech-almacen-externo");

const base: Record<string, string> = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_private",
  DEMO_DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_demo",
  AUTH_SECRET: "k8Jd-2mQ9xLp-7vRt-4nWz-1bYc-6hGf-3sAe",
  APP_ORIGIN: "http://localhost:4321",
  PRIVATE_STORAGE_DIR: "./storage/private",
  DEMO_STORAGE_DIR: "./storage/demo",
  AGENCY_TIMEZONE: "America/Mexico_City",
};

function cargar(cambios: Record<string, string | undefined> = {}) {
  return loadConfig({ ...base, ...cambios }, { projectRoot });
}

function issuesDe(cambios: Record<string, string | undefined>): string[] {
  try {
    cargar(cambios);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("se esperaba ConfigError y la configuración fue aceptada");
}

describe("loadConfig", () => {
  test("acepta una configuración válida y normaliza APP_ORIGIN", () => {
    const config = cargar({ APP_ORIGIN: "http://localhost:4321/" });
    expect(config.appOrigin).toBe("http://localhost:4321");
    expect(config.nodeEnv).toBe("development");
    expect(config.agencyTimezone).toBe("America/Mexico_City");
    expect(config.privateStorageDir).toBe(path.join(projectRoot, "storage", "private"));
    expect(config.demoStorageDir).toBe(path.join(projectRoot, "storage", "demo"));
  });

  test("falla nombrando cada variable faltante", () => {
    for (const clave of Object.keys(base)) {
      const issues = issuesDe({ [clave]: undefined });
      expect(issues.some((i) => i.startsWith(`${clave}:`))).toBe(true);
    }
  });

  test("rechaza DATABASE_URL con protocolo no postgres", () => {
    const issues = issuesDe({ DATABASE_URL: "mysql://u:p@localhost:3306/traveltech_private" });
    expect(issues.some((i) => i.startsWith("DATABASE_URL:"))).toBe(true);
  });

  test("rechaza bases privada y demo con el mismo nombre de base", () => {
    const issues = issuesDe({
      DEMO_DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_private",
    });
    expect(issues.some((i) => i.startsWith("DEMO_DATABASE_URL:"))).toBe(true);
  });

  test("rechaza AUTH_SECRET corto o de ejemplo", () => {
    for (const valor of ["x".repeat(31), "GENERATE_A_LONG_RANDOM_SECRET", "CHANGE_ME"]) {
      const issues = issuesDe({ AUTH_SECRET: valor });
      expect(issues.some((i) => i.startsWith("AUTH_SECRET:"))).toBe(true);
    }
  });

  test("rechaza zona horaria inválida", () => {
    const issues = issuesDe({ AGENCY_TIMEZONE: "Mars/Olympus" });
    expect(issues.some((i) => i.startsWith("AGENCY_TIMEZONE:"))).toBe(true);
  });

  test("rechaza APP_ORIGIN con ruta", () => {
    const issues = issuesDe({ APP_ORIGIN: "http://localhost:4321/app" });
    expect(issues.some((i) => i.startsWith("APP_ORIGIN:"))).toBe(true);
  });

  test("rechaza storage que escapa a otras carpetas del repo", () => {
    for (const valor of ["./storage/../src", "./src/x", ".", "../"]) {
      const issues = issuesDe({ PRIVATE_STORAGE_DIR: valor });
      expect(issues.some((i) => i.startsWith("PRIVATE_STORAGE_DIR:"))).toBe(true);
    }
  });

  test("rechaza storage bajo public/", () => {
    for (const valor of ["./public/privado", "./storage/../public"]) {
      const issues = issuesDe({ DEMO_STORAGE_DIR: valor });
      expect(issues.some((i) => i.startsWith("DEMO_STORAGE_DIR:"))).toBe(true);
    }
  });

  test("rechaza storage vacío", () => {
    const issues = issuesDe({ PRIVATE_STORAGE_DIR: "" });
    expect(issues.some((i) => i.startsWith("PRIVATE_STORAGE_DIR:"))).toBe(true);
  });

  test("acepta storage absoluto fuera del repo", () => {
    const config = cargar({ PRIVATE_STORAGE_DIR: fueraDelRepo });
    expect(config.privateStorageDir).toBe(fueraDelRepo);
  });

  test("rechaza storage privado y demo iguales o anidados", () => {
    const iguales = issuesDe({ DEMO_STORAGE_DIR: "./storage/private" });
    expect(iguales.some((i) => i.startsWith("DEMO_STORAGE_DIR:"))).toBe(true);
    const anidados = issuesDe({ DEMO_STORAGE_DIR: "./storage/private/demo" });
    expect(anidados.some((i) => i.startsWith("DEMO_STORAGE_DIR:"))).toBe(true);
  });

  test("ningún mensaje de error contiene valores de secretos", () => {
    const secreto = "corto-secreto-XYZ";
    const clave = "p4ssw0rd-XYZ";
    let error: unknown;
    try {
      cargar({
        AUTH_SECRET: secreto,
        DATABASE_URL: `mysql://traveltech:${clave}@localhost:3306/traveltech_private`,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const texto = JSON.stringify((error as ConfigError).issues) + (error as ConfigError).message;
    expect(texto).not.toContain("XYZ");
  });
});
