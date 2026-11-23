import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import {
  construirAstro,
  esperarRespuesta,
  lanzar,
  puertoLibre,
  type ProcesoPrueba,
} from "../support/servidor";

// Prueba de salud local: construye la aplicación REAL (no el fixture) con un entorno explícito
// (sin `.env`; el entorno explícito prevalece sobre un `.env` del desarrollador), la arranca como
// en producción con `bun run start` y comprueba `GET /api/health`.
// Efecto conocido: genera el `dist/` de la raíz (ignorado por Git) y sobrescribe el existente.

const raiz = path.resolve(import.meta.dir, "../..");
const SENTINELA = "SENTINELA-XYZ";

const entornoValido = {
  NODE_ENV: "production",
  // Puerto cerrado a propósito: `/api/health` no debe depender de la base de datos.
  DATABASE_URL: `postgresql://traveltech:${SENTINELA}-db@localhost:1/traveltech_private`,
  DEMO_DATABASE_URL: `postgresql://traveltech:${SENTINELA}-db@localhost:1/traveltech_demo`,
  AUTH_SECRET: `${SENTINELA}-k8Jd-2mQ9xLp-7vRt-4nWz-1bYc`,
  APP_ORIGIN: "http://localhost:4321",
  PRIVATE_STORAGE_DIR: "./storage/private",
  DEMO_STORAGE_DIR: "./storage/demo",
  AGENCY_TIMEZONE: "America/Mexico_City",
};

// Corto (inválido) y con el valor distintivo, para comprobar que no se filtra ni al fallar.
const SECRETO_INVALIDO = `corto-${SENTINELA}`;

const procesos: ProcesoPrueba[] = [];
let base = "";
let servidor!: ProcesoPrueba;

function entornoDe(puerto: number, cambios: Record<string, string> = {}) {
  return {
    ...process.env,
    ...entornoValido,
    ...cambios,
    HOST: "127.0.0.1",
    PORT: String(puerto),
  };
}

function iniciar(comando: string[], puerto: number, cambios: Record<string, string> = {}) {
  const proceso = lanzar(comando, { cwd: raiz, env: entornoDe(puerto, cambios) });
  procesos.push(proceso);
  return proceso;
}

async function conLimite(promesa: Promise<number>, ms: number): Promise<number> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<number>((resolve) => {
    temporizador = setTimeout(() => resolve(-1), ms);
  });
  try {
    return await Promise.race([promesa, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}

beforeAll(async () => {
  await construirAstro({
    cwd: raiz,
    env: { ...process.env, ...entornoValido },
    registrar: (proceso) => procesos.push(proceso),
  });
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  servidor = iniciar(["bun", "scripts/start.ts"], puerto);
  await esperarRespuesta(`${base}/api/health`);
}, 180_000);

afterAll(async () => {
  await Promise.all(procesos.map((proceso) => proceso.detener()));
});

describe("GET /api/health con configuración válida (bun run start)", () => {
  test("GET /api/health responde 200 con el cuerpo exacto y sin exponer nada", async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("server")).toBe(false);
    expect(response.headers.has("x-powered-by")).toBe(false);
    const texto = await response.text();
    expect(JSON.parse(texto)).toEqual({ status: "ok" });
    expect(texto).not.toContain(SENTINELA);
    expect(JSON.stringify([...response.headers.entries()])).not.toContain(SENTINELA);
  });

  test("HEAD /api/health responde 200", async () => {
    const response = await fetch(`${base}/api/health`, { method: "HEAD" });
    expect(response.status).toBe(200);
  });

  test("POST /api/health no se acepta", async () => {
    const response = await fetch(`${base}/api/health`, { method: "POST" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  test("el registro del servidor no contiene secretos", async () => {
    await fetch(`${base}/api/health`);
    await Bun.sleep(300);
    expect(servidor.salida()).not.toContain(SENTINELA);
  });
});

describe("configuración inválida", () => {
  test("start con AUTH_SECRET corto sale con código 1 sin escuchar", async () => {
    const puerto = await puertoLibre();
    const proceso = iniciar(["bun", "scripts/start.ts"], puerto, { AUTH_SECRET: SECRETO_INVALIDO });
    const codigo = await conLimite(proceso.salio, 30_000);
    expect(codigo).toBe(1);
    const salida = proceso.salida();
    expect(salida).toContain("AUTH_SECRET:");
    expect(salida).not.toContain("Server listening");
    expect(salida).not.toContain(SENTINELA);
    await expect(fetch(`http://127.0.0.1:${puerto}/api/health`)).rejects.toBeDefined();
  }, 60_000);
});
