import { describe, expect, test } from "bun:test";
import { PackageService } from "../../../src/modules/catalog/application/package-service";
import type { PackageRepository } from "../../../src/modules/catalog/domain/package-repository";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../../src/lib/errors";
import type { Package } from "../../../src/modules/catalog/types";

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
      createdAt: new Date(),
      updatedAt: new Date(),
      ...p,
    });
  }
  const escrituras: string[] = [];
  const repo: PackageRepository = {
    find: async (id) => filas.get(id) ?? null,
    create: async (datos) => {
      escrituras.push("create");
      const fila: Package = {
        id: "5f1c1c0e-0000-4000-8000-0000000000aa",
        status: "borrador",
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

describe("PackageService", () => {
  test("crear deja summary y description vacíos por defecto", async () => {
    const { repo } = repositorioFalso();
    const creado = await new PackageService(repo).create({ name: "Cancún" });
    expect(creado).toMatchObject({ summary: "", description: "", status: "borrador" });
  });

  test("crear sin nombre falla sin persistir", async () => {
    const { repo, escrituras } = repositorioFalso();
    await expect(new PackageService(repo).create({ name: " " })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(escrituras).toEqual([]);
  });

  test("ciclo borrador → publicado → archivado", async () => {
    const { repo, id } = repositorioFalso([{}]);
    const servicio = new PackageService(repo);
    expect((await servicio.publish(id)).status).toBe("publicado");
    expect((await servicio.archive(id)).status).toBe("archivado");
  });

  test("publicar con un campo vacío da 422 sin persistir", async () => {
    const { repo, escrituras, id } = repositorioFalso([{ description: "" }]);
    await expect(new PackageService(repo).publish(id)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(escrituras).toEqual([]);
  });

  test("editar un publicado dejando un campo vacío da 422 sin persistir", async () => {
    const { repo, escrituras, id } = repositorioFalso([{ status: "publicado" }]);
    await expect(new PackageService(repo).edit(id, { summary: "" })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(escrituras).toEqual([]);
  });

  test("editar un archivado da 422", async () => {
    const { repo, id } = repositorioFalso([{ status: "archivado" }]);
    await expect(new PackageService(repo).edit(id, { name: "Otro" })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  test("eliminar un publicado o archivado da 422 y no llega al DELETE", async () => {
    for (const status of ["publicado", "archivado"] as const) {
      const { repo, escrituras, id } = repositorioFalso([{ status }]);
      await expect(new PackageService(repo).delete(id)).rejects.toBeInstanceOf(BusinessRuleError);
      expect(escrituras).toEqual([]);
    }
  });

  test("eliminar un borrador lo borra", async () => {
    const { repo, filas, id } = repositorioFalso([{}]);
    await new PackageService(repo).delete(id);
    expect(filas.has(id)).toBe(false);
  });

  test("un id inexistente da 404", async () => {
    const { repo } = repositorioFalso();
    const servicio = new PackageService(repo);
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
    await expect(new PackageService(repo).publish(id)).rejects.toBeInstanceOf(ConflictError);
  });
});
