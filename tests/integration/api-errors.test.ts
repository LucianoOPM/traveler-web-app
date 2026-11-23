import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import {
  construirAstro,
  esperarRespuesta,
  lanzar,
  puertoLibre,
  type ProcesoPrueba,
} from "../support/servidor";

const raiz = path.resolve(import.meta.dir, "../..");
const fixture = "tests/fixtures/api-errors";
const entrada = path.join(raiz, fixture, "dist/server/entry.mjs");

type Servidor = ProcesoPrueba & { base: string };

const servidores: Servidor[] = [];
let produccion!: Servidor;

async function arrancar(): Promise<Servidor> {
  const puerto = await puertoLibre();
  const base = `http://127.0.0.1:${puerto}`;
  const proceso = lanzar(["bun", entrada], {
    cwd: raiz,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(puerto),
    },
  });
  const servidor: Servidor = { ...proceso, base };
  servidores.push(servidor);
  try {
    await esperarRespuesta(`${base}/api/ok`);
  } catch {
    throw new Error(`El servidor de prueba no arrancó a tiempo`);
  }
  return servidor;
}

beforeAll(async () => {
  await construirAstro({
    cwd: raiz,
    root: fixture,
    registrar: (proceso) => servidores.push({ ...proceso, base: "" }),
  });
  produccion = await arrancar();
}, 180_000);

afterAll(async () => {
  await Promise.all(servidores.map((servidor) => servidor.detener()));
});

async function registrosInesperados(servidor: Servidor): Promise<Record<string, unknown>[]> {
  await Bun.sleep(300);
  return servidor
    .salida()
    .split("\n")
    .filter((linea) => linea.includes('"event":"unexpected_error"'))
    .map((linea) => JSON.parse(linea.slice(linea.indexOf("{"))) as Record<string, unknown>);
}

describe("errores de endpoints /api/ con un servidor Astro real (producción)", () => {
  test("un ConflictError lanzado por un endpoint responde 409 con su código", async () => {
    const response = await fetch(`${produccion.base}/api/conflict`);
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: { code: "capacity_exceeded", message: "No hay capacidad disponible" },
    });
  });

  test("un ValidationError responde 400 con details", async () => {
    const response = await fetch(`${produccion.base}/api/validation`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_error",
        message: "Datos inválidos",
        details: [{ field: "email", message: "Formato inválido" }],
      },
    });
  });

  test("un error inesperado responde 500 genérico sin filtrar nada", async () => {
    const response = await fetch(`${produccion.base}/api/unexpected`);
    expect(response.status).toBe(500);
    const texto = await response.text();
    expect(JSON.parse(texto)).toEqual({
      error: { code: "internal_error", message: "Error interno del servidor" },
    });
    for (const prohibido of ["SENTINELA", "stack", "cause", "node_modules", "entry.mjs"]) {
      expect(texto).not.toContain(prohibido);
    }
    const registros = await registrosInesperados(produccion);
    expect(registros.some((r) => r.path === "/api/unexpected" && r.errorName === "Error")).toBe(
      true,
    );
    expect(produccion.salida()).not.toContain("SENTINELA");
  });

  test("un valor lanzado que no es Error responde 500 genérico", async () => {
    const response = await fetch(`${produccion.base}/api/non-error`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Error interno del servidor" },
    });
    expect(produccion.salida()).not.toContain("SENTINELA");
  });

  test("un endpoint correcto no se altera", async () => {
    const response = await fetch(`${produccion.base}/api/ok`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("una página fuera de /api/ conserva el manejo de errores de Astro", async () => {
    const pagina = await fetch(`${produccion.base}/boom`);
    expect(pagina.status).toBe(500);
    expect(pagina.headers.get("content-type") ?? "").not.toContain("application/json");
    expect(await pagina.text()).not.toContain('"internal_error"');
    expect((await fetch(`${produccion.base}/`)).status).toBe(200);
  });

  test("la query string no llega al log", async () => {
    const response = await fetch(`${produccion.base}/api/unexpected?token=SENTINELA-XYZ`);
    expect(response.status).toBe(500);
    await registrosInesperados(produccion);
    expect(produccion.salida()).not.toContain("SENTINELA");
  });
});
