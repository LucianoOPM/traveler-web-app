import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import path from "node:path";

const raiz = path.resolve(import.meta.dir, "../..");
const fixture = "tests/fixtures/api-errors";
const entrada = path.join(raiz, fixture, "dist/server/entry.mjs");

const entornoValido = {
  DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_private",
  DEMO_DATABASE_URL: "postgresql://traveltech:clave-db@localhost:5432/traveltech_demo",
  AUTH_SECRET: "k8Jd-2mQ9xLp-7vRt-4nWz-1bYc-6hGf-3sAe",
  APP_ORIGIN: "http://localhost:4321",
  PRIVATE_STORAGE_DIR: "./storage/private",
  DEMO_STORAGE_DIR: "./storage/demo",
  AGENCY_TIMEZONE: "America/Mexico_City",
};

type Servidor = {
  base: string;
  salida: () => string;
  detener: () => Promise<void>;
};

const servidores: Servidor[] = [];
let produccion!: Servidor;
let desarrollo!: Servidor;

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

async function acumular(
  flujo: ReadableStream<Uint8Array> | number | undefined,
  agregar: (texto: string) => void,
): Promise<void> {
  if (!flujo || typeof flujo === "number") return;
  const decodificador = new TextDecoder();
  for await (const trozo of flujo) agregar(decodificador.decode(trozo));
}

async function arrancar(nodeEnv: "production" | "development"): Promise<Servidor> {
  const puerto = await puertoLibre();
  const base = `http://127.0.0.1:${puerto}`;
  let salida = "";
  const proceso = Bun.spawn(["bun", entrada], {
    cwd: raiz,
    env: {
      ...process.env,
      ...entornoValido,
      NODE_ENV: nodeEnv,
      HOST: "127.0.0.1",
      PORT: String(puerto),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const agregar = (texto: string) => {
    salida += texto;
  };
  void acumular(proceso.stdout, agregar);
  void acumular(proceso.stderr, agregar);
  const servidor: Servidor = {
    base,
    salida: () => salida,
    detener: async () => {
      proceso.kill();
      await proceso.exited;
    },
  };
  servidores.push(servidor);

  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    try {
      if ((await fetch(`${base}/api/ok`)).status === 200) return servidor;
    } catch {
      // el servidor aún no escucha
    }
    await Bun.sleep(250);
  }
  throw new Error(`El servidor de prueba (${nodeEnv}) no arrancó a tiempo`);
}

beforeAll(async () => {
  // El build hereda el NODE_ENV de `bun test` (test) a propósito: es el peor caso. Que los
  // frames dependan del entorno de EJECUCIÓN garantiza que ese build no los publica en producción.
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
  produccion = await arrancar("production");
  desarrollo = await arrancar("development");
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

  test("en producción el registro no incluye frames, aunque el build se hiciera con NODE_ENV=test", async () => {
    const registros = await registrosInesperados(produccion);
    expect(registros.length).toBeGreaterThan(0);
    for (const registro of registros) expect(registro.frames).toBeUndefined();
  });
});

describe("registro con un servidor Astro real (desarrollo)", () => {
  test("en desarrollo el registro incluye frames saneados, sin rutas absolutas", async () => {
    const response = await fetch(`${desarrollo.base}/api/unexpected?token=SENTINELA-XYZ`);
    expect(response.status).toBe(500);
    const registros = await registrosInesperados(desarrollo);
    const registro = registros.find((r) => r.path === "/api/unexpected");
    expect(registro).toBeDefined();
    const frames = (registro?.frames ?? []) as string[];
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(5);
    const texto = JSON.stringify(registro);
    for (const prohibido of ["SENTINELA", "\\\\", "C:", "E:", "Users", "file:", "?"]) {
      expect(texto).not.toContain(prohibido);
    }
    expect(desarrollo.salida()).not.toContain("SENTINELA");
  });
});
