import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import path from "node:path";

const raiz = path.resolve(import.meta.dir, "../..");
const fixture = "tests/fixtures/api-errors";
const entrada = path.join(raiz, fixture, "dist/server/entry.mjs");

const entornoValido = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_private",
  DEMO_DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_demo",
  AUTH_SECRET: "k8Jd-2mQ9xLp-7vRt-4nWz-1bYc-6hGf-3sAe",
  APP_ORIGIN: "http://localhost:4321",
  PRIVATE_STORAGE_DIR: "./storage/private",
  DEMO_STORAGE_DIR: "./storage/demo",
  AGENCY_TIMEZONE: "America/Mexico_City",
};

let servidor: ReturnType<typeof Bun.spawn> | undefined;
let base = "";
let salida = "";

function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const direccion = probe.address();
      const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;
      probe.close(() => resolve(puerto));
    });
  });
}

async function acumular(flujo: ReadableStream<Uint8Array> | number | undefined): Promise<void> {
  if (!flujo || typeof flujo === "number") return;
  const decodificador = new TextDecoder();
  for await (const trozo of flujo) salida += decodificador.decode(trozo);
}

async function esperarServidor(): Promise<void> {
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    try {
      if ((await fetch(`${base}/api/ok`)).status === 200) return;
    } catch {
      // el servidor aún no escucha
    }
    await Bun.sleep(250);
  }
  throw new Error("El servidor de prueba no arrancó a tiempo");
}

function detener(): void {
  servidor?.kill();
  servidor = undefined;
}

beforeAll(async () => {
  const construccion = Bun.spawn(["bunx", "astro", "build", "--root", fixture], {
    cwd: raiz,
    stdout: "pipe",
    stderr: "pipe",
  });
  const textoConstruccion = new Response(construccion.stdout).text();
  const errorConstruccion = new Response(construccion.stderr).text();
  if ((await construccion.exited) !== 0) {
    throw new Error(
      `Falló la construcción del fixture:\n${await textoConstruccion}\n${await errorConstruccion}`,
    );
  }

  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  servidor = Bun.spawn(["bun", entrada], {
    cwd: raiz,
    env: { ...process.env, ...entornoValido, HOST: "127.0.0.1", PORT: String(puerto) },
    stdout: "pipe",
    stderr: "pipe",
  });
  void acumular(servidor.stdout);
  void acumular(servidor.stderr);
  try {
    await esperarServidor();
  } catch (error) {
    detener();
    throw error;
  }
}, 180_000);

afterAll(async () => {
  const proceso = servidor;
  detener();
  await proceso?.exited;
});

async function registrosInesperados(): Promise<Record<string, unknown>[]> {
  await Bun.sleep(300);
  return salida
    .split("\n")
    .filter((linea) => linea.includes('"event":"unexpected_error"'))
    .map((linea) => JSON.parse(linea.slice(linea.indexOf("{"))) as Record<string, unknown>);
}

describe("errores de endpoints /api/ con un servidor Astro real", () => {
  test("un ConflictError lanzado por un endpoint responde 409 con su código", async () => {
    const response = await fetch(`${base}/api/conflict`);
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: { code: "capacity_exceeded", message: "No hay capacidad disponible" },
    });
  });

  test("un ValidationError responde 400 con details", async () => {
    const response = await fetch(`${base}/api/validation`);
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
    const response = await fetch(`${base}/api/unexpected`);
    expect(response.status).toBe(500);
    const texto = await response.text();
    expect(JSON.parse(texto)).toEqual({
      error: { code: "internal_error", message: "Error interno del servidor" },
    });
    for (const prohibido of ["SENTINELA", "stack", "cause", "node_modules", "entry.mjs"]) {
      expect(texto).not.toContain(prohibido);
    }
    const registros = await registrosInesperados();
    expect(registros.some((r) => r.path === "/api/unexpected" && r.errorName === "Error")).toBe(
      true,
    );
    expect(salida).not.toContain("SENTINELA");
  });

  test("un valor lanzado que no es Error responde 500 genérico", async () => {
    const response = await fetch(`${base}/api/non-error`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Error interno del servidor" },
    });
    expect(salida).not.toContain("SENTINELA");
  });

  test("un endpoint correcto no se altera", async () => {
    const response = await fetch(`${base}/api/ok`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("una página fuera de /api/ conserva el manejo de errores de Astro", async () => {
    const pagina = await fetch(`${base}/boom`);
    expect(pagina.status).toBe(500);
    expect(pagina.headers.get("content-type") ?? "").not.toContain("application/json");
    expect(await pagina.text()).not.toContain('"internal_error"');
    expect((await fetch(`${base}/`)).status).toBe(200);
  });

  test("la query string no llega al log", async () => {
    const response = await fetch(`${base}/api/unexpected?token=SENTINELA-XYZ`);
    expect(response.status).toBe(500);
    await registrosInesperados();
    expect(salida).not.toContain("SENTINELA");
  });
});
