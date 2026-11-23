import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AlmacenEnDisco } from "../../../src/modules/media/infrastructure/almacen-en-disco";

let raiz = "";
beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "almacen-"));
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

describe("AlmacenEnDisco", () => {
  test("guarda, lee y borra; leer o borrar lo inexistente no falla", async () => {
    const almacen = new AlmacenEnDisco(raiz);
    await almacen.guardar("media/a.jpg", new Uint8Array([1, 2, 3]));
    expect([...(await almacen.leer("media/a.jpg"))!]).toEqual([1, 2, 3]);
    await almacen.borrar("media/a.jpg");
    expect(await almacen.leer("media/a.jpg")).toBeNull();
    await almacen.borrar("media/a.jpg");
  });

  test("no sobrescribe un archivo existente", async () => {
    const almacen = new AlmacenEnDisco(raiz);
    await almacen.guardar("media/a.jpg", new Uint8Array([1]));
    await expect(almacen.guardar("media/a.jpg", new Uint8Array([2]))).rejects.toThrow();
  });

  test("rechaza claves fuera de la raíz (recorrido de rutas y rutas absolutas)", async () => {
    const almacen = new AlmacenEnDisco(raiz);
    for (const clave of ["../fuera.jpg", "media/../../fuera.jpg", path.resolve(raiz, "..", "x")]) {
      await expect(almacen.guardar(clave, new Uint8Array([1]))).rejects.toThrow("fuera");
      await expect(almacen.leer(clave)).rejects.toThrow("fuera");
      await expect(almacen.borrar(clave)).rejects.toThrow("fuera");
    }
    expect(await readdir(path.dirname(raiz)).then((f) => f.includes("fuera.jpg"))).toBe(false);
  });
});
