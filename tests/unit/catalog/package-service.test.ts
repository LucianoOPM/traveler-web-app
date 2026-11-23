import { describe, expect, test } from "bun:test";
import { PackageService } from "@modules/catalog/application/package-service";
import type { PackageRepository } from "@modules/catalog/domain/package-repository";
import { BusinessRuleError, ConflictError, NotFoundError } from "@lib/errors";
import type { Package } from "@modules/catalog/types";
import type { MediaAsset } from "@modules/media/types";

// Repositorio en memoria que registra las escrituras, para comprobar que las reglas de negocio
// fallan ANTES de llegar a la persistencia.
function repositorioFalso(inicial: Partial<Package>[] = []) {
  const filas = new Map<string, Package>();
  for (const [i, p] of inicial.entries()) {
    const id = p.id ?? `5f1c1c0e-0000-4000-8000-00000000000${i + 1}`;
    filas.set(id, {
      id,
      name: "Cancún",
      summary: "Resumen",
      description: "Descripción",
      status: "borrador",
      coverAssetId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...p,
    });
  }
  const escrituras: string[] = [];
  const repo: PackageRepository = {
    find: async (id) => filas.get(id) ?? null,
    findByCover: async (id) => [...filas.values()].find((p) => p.coverAssetId === id) ?? null,
    list: async () => [...filas.values()],
    listPublished: async () => [...filas.values()].filter((p) => p.status === "publicado"),
    create: async (datos) => {
      escrituras.push("create");
      const fila: Package = {
        id: "5f1c1c0e-0000-4000-8000-0000000000aa",
        status: "borrador",
        coverAssetId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...datos,
      };
      filas.set(fila.id, fila);
      return fila;
    },
    update: async (id, esperado, cambios) => {
      escrituras.push("update");
      const fila = filas.get(id);
      if (!fila || fila.status !== esperado) return null;
      const nueva = { ...fila, ...cambios };
      filas.set(id, nueva);
      return nueva;
    },
    delete: async (id, esperado) => {
      escrituras.push("delete");
      if (filas.get(id)?.status !== esperado) return false;
      return filas.delete(id);
    },
  };
  return { repo, filas, escrituras, id: [...filas.keys()][0]! };
}

// Media falsa que registra el orden de las operaciones (para comprobar «borrar tras confirmar»).
function mediaFalsa() {
  const eventos: string[] = [];
  let n = 0;
  const media = {
    guardar: async () => {
      const id = `5f1c1c0e-0000-4000-8000-0000000001${String(++n).padStart(2, "0")}`;
      eventos.push(`guardar ${id}`);
      return { id } as MediaAsset;
    },
    eliminar: async (id: string) => void eventos.push(`eliminar ${id}`),
  };
  return { media, eventos };
}
const BYTES = new Uint8Array([1]);
const PORTADA = "5f1c1c0e-0000-4000-8000-0000000001aa";

describe("PackageService.setCover", () => {
  test("asigna la portada y borra la anterior solo después de confirmar el cambio", async () => {
    const { repo, filas, id } = repositorioFalso([{ coverAssetId: PORTADA }]);
    const { media, eventos } = mediaFalsa();
    const original = repo.update;
    repo.update = async (...args) => {
      eventos.push("update");
      return original(...args);
    };
    const actualizado = await new PackageService(repo, media).setCover(id, BYTES);
    expect(actualizado.coverAssetId).not.toBe(PORTADA);
    expect(filas.get(id)!.coverAssetId).toBe(actualizado.coverAssetId);
    expect(eventos.map((e) => e.split(" ")[0])).toEqual(["guardar", "update", "eliminar"]);
    expect(eventos[2]).toBe(`eliminar ${PORTADA}`);
  });

  test("si el cambio no se confirma, borra la nueva y conserva la anterior", async () => {
    const { repo, id } = repositorioFalso([{ coverAssetId: PORTADA }]);
    const { media, eventos } = mediaFalsa();
    repo.update = async () => null; // cambio concurrente
    await expect(new PackageService(repo, media).setCover(id, BYTES)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(eventos.map((e) => e.split(" ")[0])).toEqual(["guardar", "eliminar"]);
    expect(eventos.some((e) => e === `eliminar ${PORTADA}`)).toBe(false);
  });

  test("un archivado, un inexistente o una imagen inválida no guardan nada", async () => {
    const { repo, id } = repositorioFalso([{ status: "archivado" }]);
    const { media, eventos } = mediaFalsa();
    const servicio = new PackageService(repo, media);
    await expect(servicio.setCover(id, BYTES)).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      servicio.setCover("5f1c1c0e-0000-4000-8000-0000000000ff", BYTES),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(eventos).toEqual([]);
  });

  test("eliminar un borrador con portada borra su archivo", async () => {
    const { repo, id } = repositorioFalso([{ coverAssetId: PORTADA }]);
    const { media, eventos } = mediaFalsa();
    await new PackageService(repo, media).delete(id);
    expect(eventos).toEqual([`eliminar ${PORTADA}`]);
  });

  test("un fallo al borrar el archivo anterior no hace fallar la operación", async () => {
    const { repo, id } = repositorioFalso([{ coverAssetId: PORTADA }]);
    const { media } = mediaFalsa();
    media.eliminar = async () => {
      throw new Error("disco");
    };
    await expect(new PackageService(repo, media).setCover(id, BYTES)).resolves.toBeDefined();
  });
});

describe("PackageService", () => {
  test("get devuelve el paquete y list lo que haya en el repositorio", async () => {
    const { repo, id } = repositorioFalso([{}]);
    const servicio = new PackageService(repo, mediaFalsa().media);
    expect((await servicio.get(id)).id).toBe(id);
    expect(await servicio.list()).toHaveLength(1);
  });

  test("get de un id inexistente da 404", async () => {
    const { repo } = repositorioFalso();
    await expect(
      new PackageService(repo, mediaFalsa().media).get("5f1c1c0e-0000-4000-8000-0000000000ff"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("crear deja summary y description vacíos por defecto", async () => {
    const { repo } = repositorioFalso();
    const creado = await new PackageService(repo, mediaFalsa().media).create({ name: "Cancún" });
    expect(creado).toMatchObject({ summary: "", description: "", status: "borrador" });
  });

  test("crear sin nombre falla sin persistir", async () => {
    const { repo, escrituras } = repositorioFalso();
    await expect(
      new PackageService(repo, mediaFalsa().media).create({ name: " " }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(escrituras).toEqual([]);
  });

  test("ciclo borrador → publicado → archivado", async () => {
    const { repo, id } = repositorioFalso([{}]);
    const servicio = new PackageService(repo, mediaFalsa().media);
    expect((await servicio.publish(id)).status).toBe("publicado");
    expect((await servicio.archive(id)).status).toBe("archivado");
  });

  test("publicar con un campo vacío da 422 sin persistir", async () => {
    const { repo, escrituras, id } = repositorioFalso([{ description: "" }]);
    await expect(new PackageService(repo, mediaFalsa().media).publish(id)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(escrituras).toEqual([]);
  });

  test("editar un publicado dejando un campo vacío da 422 sin persistir", async () => {
    const { repo, escrituras, id } = repositorioFalso([{ status: "publicado" }]);
    await expect(
      new PackageService(repo, mediaFalsa().media).edit(id, { summary: "" }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(escrituras).toEqual([]);
  });

  test("editar un archivado da 422", async () => {
    const { repo, id } = repositorioFalso([{ status: "archivado" }]);
    await expect(
      new PackageService(repo, mediaFalsa().media).edit(id, { name: "Otro" }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  test("eliminar un publicado o archivado da 422 y no llega al DELETE", async () => {
    for (const status of ["publicado", "archivado"] as const) {
      const { repo, escrituras, id } = repositorioFalso([{ status }]);
      await expect(new PackageService(repo, mediaFalsa().media).delete(id)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
      expect(escrituras).toEqual([]);
    }
  });

  test("eliminar un borrador lo borra", async () => {
    const { repo, filas, id } = repositorioFalso([{}]);
    await new PackageService(repo, mediaFalsa().media).delete(id);
    expect(filas.has(id)).toBe(false);
  });

  test("un id inexistente da 404", async () => {
    const { repo } = repositorioFalso();
    const servicio = new PackageService(repo, mediaFalsa().media);
    const inexistente = "5f1c1c0e-0000-4000-8000-0000000000ff";
    for (const operacion of [
      () => servicio.edit(inexistente, { name: "x" }),
      () => servicio.publish(inexistente),
      () => servicio.archive(inexistente),
      () => servicio.delete(inexistente),
    ]) {
      await expect(operacion()).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  test("si el estado cambió entre la lectura y la escritura da 409", async () => {
    const { repo, filas, id } = repositorioFalso([{}]);
    const find = repo.find;
    // Otro admin publica justo después de que este servicio lee el borrador.
    repo.find = async (pid) => {
      const leido = await find(pid);
      filas.set(pid, { ...filas.get(pid)!, status: "publicado" });
      return leido;
    };
    await expect(new PackageService(repo, mediaFalsa().media).publish(id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
