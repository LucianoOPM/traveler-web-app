// Conexión del servidor a la base privada. Perezosa y con importación dinámica: `bun` solo existe al
// ejecutar bajo Bun, y el build (Node) no debe cargarlo. La URL viene del entorno, nunca del cliente.
let base: Promise<ReturnType<typeof import("./conexion").abrirBase>["db"]> | undefined;

export function baseDelServidor() {
  base ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL: es obligatoria");
    const { abrirBase } = await import("./conexion");
    return abrirBase(url).db;
  })();
  return base;
}
