import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AlmacenArchivos } from "../domain/almacen-archivos";

/** Guarda bajo `raiz` (p. ej. `PRIVATE_STORAGE_DIR`, nunca dentro de `public/`). */
export class AlmacenEnDisco implements AlmacenArchivos {
  constructor(private readonly raiz: string) {}

  async guardar(clave: string, bytes: Uint8Array) {
    const ruta = this.ruta(clave);
    await mkdir(path.dirname(ruta), { recursive: true });
    await writeFile(ruta, bytes, { flag: "wx" });
  }

  async leer(clave: string) {
    try {
      return new Uint8Array(await readFile(this.ruta(clave)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async borrar(clave: string) {
    await rm(this.ruta(clave), { force: true });
  }

  // Una clave que escape de la raíz es un error de programación: la generan el servidor, no el cliente.
  private ruta(clave: string) {
    const raiz = path.resolve(this.raiz);
    const ruta = path.resolve(raiz, clave);
    const relativa = path.relative(raiz, ruta);
    if (relativa === "" || relativa.startsWith("..") || path.isAbsolute(relativa)) {
      throw new Error("La clave de almacenamiento apunta fuera de la raíz");
    }
    return ruta;
  }
}
