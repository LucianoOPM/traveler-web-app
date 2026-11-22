import { createServer } from "node:net";

/** Proceso hijo de una prueba: salida capturada, código de salida y cierre seguro. */
export type ProcesoPrueba = {
  salida: () => string;
  /** Resuelve con el código de salida cuando el proceso termina. */
  salio: Promise<number>;
  /** Termina el proceso y espera a que cierre; no falla si ya había terminado. */
  detener: () => Promise<void>;
};

type OpcionesLanzar = {
  cwd: string;
  env?: Record<string, string | undefined>;
};

export function puertoLibre(): Promise<number> {
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

export function lanzar(comando: string[], opciones: OpcionesLanzar): ProcesoPrueba {
  let salida = "";
  const proceso = Bun.spawn(comando, {
    cwd: opciones.cwd,
    env: opciones.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const agregar = (texto: string) => {
    salida += texto;
  };
  void acumular(proceso.stdout, agregar);
  void acumular(proceso.stderr, agregar);
  return {
    salida: () => salida,
    salio: proceso.exited,
    detener: async () => {
      proceso.kill();
      await proceso.exited;
    },
  };
}

/** Reintenta hasta que la URL responda 200; lanza un error si se acaba el tiempo. */
export async function esperarRespuesta(url: string, limiteMs = 30_000): Promise<void> {
  const limite = Date.now() + limiteMs;
  while (Date.now() < limite) {
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // el servidor aún no escucha
    }
    await Bun.sleep(250);
  }
  throw new Error(`El servidor de prueba no respondió 200 en ${url} a tiempo`);
}

/** Ejecuta `astro build` (opcionalmente con `--root`) y falla con la salida si termina mal. */
export async function construirAstro(opciones: OpcionesLanzar & { root?: string }): Promise<void> {
  const comando = ["bunx", "astro", "build", ...(opciones.root ? ["--root", opciones.root] : [])];
  const proceso = lanzar(comando, { cwd: opciones.cwd, env: opciones.env });
  const codigo = await proceso.salio;
  if (codigo !== 0) {
    throw new Error(`Falló astro build (código ${codigo}):\n${proceso.salida()}`);
  }
}
