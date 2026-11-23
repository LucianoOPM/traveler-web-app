import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../src/lib/config";

const raiz = path.resolve(import.meta.dir, "../..");
const leer = (ruta: string) => readFileSync(path.join(raiz, ruta), "utf8");

const compose = () => leer("docker-compose.yml");
const sqlInicial = () => leer("docker/postgres/init/01-crear-bases.sql");
const envEjemplo = () => leer(".env.example");

function parsearEnv(texto: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const linea of texto.split(/\r?\n/)) {
    if (linea.trim() === "" || linea.trimStart().startsWith("#")) continue;
    const i = linea.indexOf("=");
    resultado[linea.slice(0, i)] = linea.slice(i + 1);
  }
  return resultado;
}

const nombreDeBase = (url: string) => new URL(url).pathname.replace(/^\//, "");

describe("docker-compose.yml", () => {
  test("la imagen de PostgreSQL tiene etiqueta exacta", () => {
    expect(compose()).toMatch(/^\s+image:\s*postgres:17\.10-alpine\s*$/m);
    expect(compose()).not.toContain("latest");
  });

  test("el puerto solo se publica en 127.0.0.1", () => {
    expect(compose()).toContain("127.0.0.1:5432:5432");
    expect(compose()).not.toMatch(/^\s*-\s*["']?5432:5432/m);
  });

  test("la contraseña es obligatoria", () => {
    expect(compose()).toContain("POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?");
  });

  test("los datos viven en un volumen con nombre", () => {
    expect(compose()).toContain("traveltech_pgdata:/var/lib/postgresql/data");
    expect(compose()).toMatch(/^volumes:\s*\n\s+traveltech_pgdata:/m);
  });

  test("el healthcheck fuerza TCP", () => {
    expect(compose()).toMatch(/pg_isready[^\n]*-h 127\.0\.0\.1/);
  });

  test("el script de inicialización se monta como solo lectura", () => {
    expect(compose()).toContain("./docker/postgres/init:/docker-entrypoint-initdb.d:ro");
  });
});

describe("script de inicialización", () => {
  test("crea exactamente las tres bases", () => {
    const sql = sqlInicial();
    expect(sql).toContain("CREATE DATABASE traveltech_private;");
    expect(sql).toContain("CREATE DATABASE traveltech_demo;");
    expect(sql).toContain("CREATE DATABASE traveltech_test;");
    expect(sql.match(/CREATE DATABASE/g)).toHaveLength(3);
  });
});

describe(".env.example", () => {
  test("las bases de las URLs existen en el script", () => {
    const env = parsearEnv(envEjemplo());
    expect(sqlInicial()).toContain(nombreDeBase(env.DATABASE_URL));
    expect(sqlInicial()).toContain(nombreDeBase(env.DEMO_DATABASE_URL));
  });

  test("declara POSTGRES_PASSWORD", () => {
    expect(envEjemplo()).toMatch(/^POSTGRES_PASSWORD=.+$/m);
  });

  test("deja TEST_DATABASE_URL comentada y apuntando a traveltech_test", () => {
    const texto = envEjemplo();
    expect(texto).not.toMatch(/^TEST_DATABASE_URL=/m);
    const comentada = texto.match(/^# TEST_DATABASE_URL=(.+)$/m);
    expect(comentada).not.toBeNull();
    expect(nombreDeBase(comentada![1]!)).toBe("traveltech_test");
  });

  test("sigue siendo válido para loadConfig y no filtra las variables de Compose", () => {
    const env = parsearEnv(envEjemplo());
    const config = loadConfig(
      { ...env, AUTH_SECRET: "k8Jd-2mQ9xLp-7vRt-4nWz-1bYc-6hGf-3sAe" },
      { projectRoot: raiz },
    );
    expect(Object.keys(config).sort()).toEqual(
      [
        "agencyTimezone",
        "appOrigin",
        "authSecret",
        "databaseUrl",
        "demoDatabaseUrl",
        "demoStorageDir",
        "nodeEnv",
        "privateStorageDir",
      ].sort(),
    );
  });
});
