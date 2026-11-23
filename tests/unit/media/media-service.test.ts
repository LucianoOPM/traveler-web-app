import { describe, expect, test } from "bun:test";
import { BusinessRuleError, NotFoundError } from "@lib/errors";
import { MediaService, TAMANO_MAXIMO } from "@modules/media/application/media-service";
import type { AlmacenArchivos } from "@modules/media/domain/almacen-archivos";
import type { MediaRepository } from "@modules/media/domain/media-repository";
import type { MediaAsset } from "@modules/media/types";
import { jpeg, jpegDe, png } from "../../support/imagenes";

function montar(fallaCrear = false) {
  const archivos = new Map<string, Uint8Array>();
  const filas = new Map<string, MediaAsset>();
  const almacen: AlmacenArchivos = {
    guardar: async (clave, bytes) => void archivos.set(clave, bytes),
    leer: async (clave) => archivos.get(clave) ?? null,
    borrar: async (clave) => void archivos.delete(clave),
  };
  const repo: MediaRepository = {
    find: async (id) => filas.get(id) ?? null,
    create: async (datos) => {
      if (fallaCrear) throw new Error("fallo de base");
      const fila = { createdAt: new Date(), ...datos } as MediaAsset;
      filas.set(fila.id, fila);
      return fila;
    },
    delete: async (id) => void filas.delete(id),
  };
  return { servicio: new MediaService(repo, almacen), archivos, filas };
}

describe("MediaService", () => {
  test("guarda con clave propia y el tipo sale de la firma", async () => {
    const { servicio, archivos } = montar();
    const asset = await servicio.guardar(png());
    expect(asset.contentType).toBe("image/png");
    expect(asset.storageKey).toBe(`media/${asset.id}.png`);
    expect(asset.sizeBytes).toBe(png().length);
    expect(archivos.has(asset.storageKey)).toBe(true);
  });

  test("rechaza vacío, tipo no admitido y mayor de 5 MiB sin escribir nada", async () => {
    const { servicio, archivos } = montar();
    await expect(servicio.guardar(new Uint8Array())).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(servicio.guardar(new TextEncoder().encode("<svg></svg>"))).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await expect(servicio.guardar(jpegDe(TAMANO_MAXIMO + 1))).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(archivos.size).toBe(0);
    await servicio.guardar(jpegDe(TAMANO_MAXIMO)); // el límite exacto es válido
    expect(archivos.size).toBe(1);
  });

  test("si falla la base, no deja el archivo", async () => {
    const { servicio, archivos } = montar(true);
    await expect(servicio.guardar(jpeg())).rejects.toThrow("fallo de base");
    expect(archivos.size).toBe(0);
  });

  test("abrir devuelve los bytes; inexistente o sin archivo da 404", async () => {
    const { servicio, archivos } = montar();
    const asset = await servicio.guardar(jpeg());
    expect((await servicio.abrir(asset.id)).bytes).toEqual(jpeg());
    archivos.clear();
    await expect(servicio.abrir(asset.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(servicio.abrir(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  test("eliminar borra archivo y fila, y es idempotente", async () => {
    const { servicio, archivos, filas } = montar();
    const asset = await servicio.guardar(jpeg());
    await servicio.eliminar(asset.id);
    await servicio.eliminar(asset.id);
    expect(archivos.size + filas.size).toBe(0);
  });
});
