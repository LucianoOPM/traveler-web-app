import { describe, expect, test } from "bun:test";
import { BoardingPointService } from "../../../src/modules/catalog/application/boarding-point-service";
import { DepartureService } from "../../../src/modules/catalog/application/departure-service";
import type { BoardingPointRepository } from "../../../src/modules/catalog/domain/boarding-point-repository";
import type { DepartureRepository } from "../../../src/modules/catalog/domain/departure-repository";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../../src/lib/errors";
import type { Departure, PackageStatus } from "../../../src/modules/catalog/types";

const SALIDA = "5f1c1c0e-0000-4000-8000-000000000001";
const PAQUETE = "5f1c1c0e-0000-4000-8000-0000000000a1";
const PUNTO = "5f1c1c0e-0000-4000-8000-0000000000b1";
const INEXISTENTE = "5f1c1c0e-0000-4000-8000-0000000000ff";

const contenido = {
  startsAt: new Date("2027-01-10T10:00:00Z"),
  endsAt: new Date("2027-01-12T10:00:00Z"),
  capacity: 10,
  adultPriceCents: 150000,
  childPriceCents: 100000,
  infantPriceCents: 0,
};

// Repositorio en memoria que registra las escrituras, para comprobar que las reglas de negocio
// fallan ANTES de llegar a la persistencia.
function repositorioFalso(
  inicial: Partial<Departure> | null = {},
  estadoPaquete: PackageStatus | null = "publicado",
) {
  const filas = new Map<string, Departure>();
  if (inicial) {
    filas.set(SALIDA, {
      id: SALIDA,
      packageId: PAQUETE,
      ...contenido,
      status: "borrador",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...inicial,
    });
  }
  const asignados = new Set<string>();
  const escrituras: string[] = [];
  const repo: DepartureRepository = {
    find: async (id) => filas.get(id) ?? null,
    findPackageStatus: async () => estadoPaquete,
    create: async (datos) => {
      escrituras.push("create");
      const fila: Departure = {
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
    addBoardingPoint: async (_salida, punto) => {
      escrituras.push("addBoardingPoint");
      if (asignados.has(punto)) return false;
      asignados.add(punto);
      return true;
    },
    removeBoardingPoint: async (_salida, punto) => {
      escrituras.push("removeBoardingPoint");
      return asignados.delete(punto);
    },
  };
  return { repo, filas, escrituras };
}

describe("DepartureService", () => {
  test("crear devuelve un borrador", async () => {
    const { repo } = repositorioFalso(null);
    const creada = await new DepartureService(repo).create({ packageId: PAQUETE, ...contenido });
    expect(creada).toMatchObject({ status: "borrador", capacity: 10 });
  });

  test("crear sobre un paquete inexistente da 404 sin persistir", async () => {
    const { repo, escrituras } = repositorioFalso(null, null);
    await expect(
      new DepartureService(repo).create({ packageId: INEXISTENTE, ...contenido }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(escrituras).toEqual([]);
  });

  test.each([
    ["termina antes de iniciar", { endsAt: new Date("2027-01-09T10:00:00Z") }],
    ["termina justo al iniciar", { endsAt: contenido.startsAt }],
    ["capacidad negativa", { capacity: -1 }],
    ["capacidad con decimales", { capacity: 1.5 }],
    ["tarifa negativa", { childPriceCents: -1 }],
    ["tarifa con decimales", { adultPriceCents: 10.5 }],
    ["fecha inválida", { startsAt: new Date("no es fecha") }],
  ])("crear con %s da 422 sin persistir", async (_nombre, cambio) => {
    const { repo, escrituras } = repositorioFalso(null);
    await expect(
      new DepartureService(repo).create({ packageId: PAQUETE, ...contenido, ...cambio }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(escrituras).toEqual([]);
  });

  test("capacidad y tarifas en cero son válidas", async () => {
    const { repo } = repositorioFalso(null);
    const creada = await new DepartureService(repo).create({
      packageId: PAQUETE,
      ...contenido,
      capacity: 0,
      adultPriceCents: 0,
    });
    expect(creada.capacity).toBe(0);
  });

  test("editar valida el resultado combinado con lo ya guardado", async () => {
    const { repo, escrituras } = repositorioFalso({});
    await expect(
      new DepartureService(repo).edit(SALIDA, { endsAt: new Date("2027-01-01T00:00:00Z") }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(escrituras).toEqual([]);
  });

  test("editar sin cambios no escribe; con cambios actualiza", async () => {
    const { repo, escrituras } = repositorioFalso({});
    const servicio = new DepartureService(repo);
    await servicio.edit(SALIDA, { capacity: undefined });
    expect(escrituras).toEqual([]);
    expect((await servicio.edit(SALIDA, { capacity: 20 })).capacity).toBe(20);
  });

  test("editar una publicada se permite; una cancelada da 422", async () => {
    const publicada = repositorioFalso({ status: "publicada" });
    expect(
      (await new DepartureService(publicada.repo).edit(SALIDA, { capacity: 5 })).capacity,
    ).toBe(5);
    const cancelada = repositorioFalso({ status: "cancelada" });
    await expect(
      new DepartureService(cancelada.repo).edit(SALIDA, { capacity: 5 }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(cancelada.escrituras).toEqual([]);
  });

  test("ciclo borrador → publicada → cancelada", async () => {
    const { repo } = repositorioFalso({});
    const servicio = new DepartureService(repo);
    expect((await servicio.publish(SALIDA)).status).toBe("publicada");
    expect((await servicio.cancel(SALIDA)).status).toBe("cancelada");
  });

  test.each(["borrador", "archivado"] as const)(
    "publicar con el paquete en %s da 422 sin persistir",
    async (estado) => {
      const { repo, escrituras } = repositorioFalso({}, estado);
      await expect(new DepartureService(repo).publish(SALIDA)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
      expect(escrituras).toEqual([]);
    },
  );

  test("transiciones inválidas dan 422: republicar, cancelar un borrador, volver a publicar", async () => {
    for (const [inicial, operacion] of [
      ["publicada", (s: DepartureService) => s.publish(SALIDA)],
      ["cancelada", (s: DepartureService) => s.publish(SALIDA)],
      ["borrador", (s: DepartureService) => s.cancel(SALIDA)],
      ["cancelada", (s: DepartureService) => s.cancel(SALIDA)],
    ] as const) {
      const { repo, escrituras } = repositorioFalso({ status: inicial });
      await expect(operacion(new DepartureService(repo))).rejects.toBeInstanceOf(BusinessRuleError);
      expect(escrituras).toEqual([]);
    }
  });

  test("eliminar solo borradores", async () => {
    for (const status of ["publicada", "cancelada"] as const) {
      const { repo, escrituras } = repositorioFalso({ status });
      await expect(new DepartureService(repo).delete(SALIDA)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
      expect(escrituras).toEqual([]);
    }
    const { repo, filas } = repositorioFalso({});
    await new DepartureService(repo).delete(SALIDA);
    expect(filas.has(SALIDA)).toBe(false);
  });

  test("un id inexistente da 404", async () => {
    const { repo } = repositorioFalso(null);
    const servicio = new DepartureService(repo);
    for (const operacion of [
      () => servicio.edit(INEXISTENTE, { capacity: 1 }),
      () => servicio.publish(INEXISTENTE),
      () => servicio.cancel(INEXISTENTE),
      () => servicio.delete(INEXISTENTE),
      () => servicio.assignBoardingPoint(INEXISTENTE, PUNTO),
      () => servicio.removeBoardingPoint(INEXISTENTE, PUNTO),
      () => servicio.availableSeats(INEXISTENTE),
    ]) {
      await expect(operacion()).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  test("si el estado cambió entre la lectura y la escritura da 409", async () => {
    const { repo, filas } = repositorioFalso({});
    const find = repo.find;
    // Otro admin publica justo después de que este servicio lee el borrador.
    repo.find = async (id) => {
      const leida = await find(id);
      filas.set(id, { ...filas.get(id)!, status: "publicada" });
      return leida;
    };
    await expect(new DepartureService(repo).publish(SALIDA)).rejects.toBeInstanceOf(ConflictError);
  });

  test("asignar dos veces el mismo punto da 409; quitar uno no asignado da 404", async () => {
    const { repo } = repositorioFalso({});
    const servicio = new DepartureService(repo);
    await servicio.assignBoardingPoint(SALIDA, PUNTO);
    await expect(servicio.assignBoardingPoint(SALIDA, PUNTO)).rejects.toBeInstanceOf(ConflictError);
    await servicio.removeBoardingPoint(SALIDA, PUNTO);
    await expect(servicio.removeBoardingPoint(SALIDA, PUNTO)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("en una salida cancelada no se asignan ni quitan puntos (422)", async () => {
    const { repo, escrituras } = repositorioFalso({ status: "cancelada" });
    const servicio = new DepartureService(repo);
    await expect(servicio.assignBoardingPoint(SALIDA, PUNTO)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await expect(servicio.removeBoardingPoint(SALIDA, PUNTO)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(escrituras).toEqual([]);
  });

  test("availableSeats devuelve la capacidad total (provisional hasta H3)", async () => {
    const { repo } = repositorioFalso({ capacity: 42 });
    expect(await new DepartureService(repo).availableSeats(SALIDA)).toBe(42);
  });
});

describe("BoardingPointService", () => {
  const punto = { id: PUNTO, name: "Terminal Norte", createdAt: new Date() };
  const repo: BoardingPointRepository = {
    create: async (name) => ({ ...punto, name }),
    update: async (id, name) => (id === PUNTO ? { ...punto, name } : null),
    delete: async (id) => id === PUNTO,
  };
  const servicio = new BoardingPointService(repo);

  test("recorta el nombre y rechaza uno vacío (422)", async () => {
    expect((await servicio.create("  Terminal Norte ")).name).toBe("Terminal Norte");
    await expect(servicio.create("  ")).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(servicio.edit(PUNTO, "")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  test("editar o eliminar un id inexistente da 404", async () => {
    await expect(servicio.edit(INEXISTENTE, "x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(servicio.delete(INEXISTENTE)).rejects.toBeInstanceOf(NotFoundError);
  });
});
