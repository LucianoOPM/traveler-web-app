import { describe, expect, test } from "bun:test";
import { NotFoundError } from "../../../src/lib/errors";
import { PublicCatalogService } from "../../../src/modules/catalog/application/public-catalog-service";
import type { BoardingPointRepository } from "../../../src/modules/catalog/domain/boarding-point-repository";
import type { DepartureRepository } from "../../../src/modules/catalog/domain/departure-repository";
import type { PackageRepository } from "../../../src/modules/catalog/domain/package-repository";
import type {
  BoardingPoint,
  DepartureStatus,
  Package,
  PackageStatus,
} from "../../../src/modules/catalog/types";

const AHORA = new Date("2027-06-01T12:00:00Z");
const DIA = 86_400_000;
const idDe = (n: number) => `5f1c1c0e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PUNTO_A = idDe(900);
const PUNTO_B = idDe(901);

const paquete = (n: number, status: PackageStatus): Package => ({
  id: idDe(n),
  name: `Paquete ${n}`,
  summary: `Resumen ${n}`,
  description: `Descripción ${n}`,
  status,
  createdAt: new Date("2027-01-01T00:00:00Z"),
  updatedAt: new Date("2027-01-02T00:00:00Z"),
});

const salida = (n: number, packageId: string, status: DepartureStatus, dias: number) => ({
  id: idDe(100 + n),
  packageId,
  startsAt: new Date(AHORA.getTime() + dias * DIA),
  endsAt: new Date(AHORA.getTime() + (dias + 3) * DIA),
  capacity: 20 + n,
  adultPriceCents: 150050,
  childPriceCents: 100000,
  infantPriceCents: 0,
  status,
  createdAt: new Date("2027-01-01T00:00:00Z"),
  updatedAt: new Date("2027-01-02T00:00:00Z"),
  boardingPointIds: [PUNTO_A],
});

function servicio(paquetes: Package[], salidas: ReturnType<typeof salida>[]) {
  const paquetesRepo = {
    find: async (id: string) => paquetes.find((p) => p.id === id) ?? null,
    listPublished: async () => paquetes.filter((p) => p.status === "publicado"),
  } as unknown as PackageRepository;
  const salidasRepo = {
    listByPackage: async (id: string) =>
      salidas.filter((s) => s.packageId === id).sort((a, b) => +a.startsAt - +b.startsAt),
  } as unknown as DepartureRepository;
  const puntos = [
    { id: PUNTO_A, name: "Terminal Norte", createdAt: new Date() },
    { id: PUNTO_B, name: "Plaza Sur", createdAt: new Date() },
  ] satisfies BoardingPoint[];
  const puntosRepo = { list: async () => puntos } as unknown as BoardingPointRepository;
  const consultadas: string[] = [];
  const plazas = {
    availableSeats: async (id: string) => {
      consultadas.push(id);
      return salidas.find((s) => s.id === id)!.capacity;
    },
  };
  return {
    svc: new PublicCatalogService(paquetesRepo, salidasRepo, puntosRepo, plazas),
    consultadas,
  };
}

describe("PublicCatalogService.list", () => {
  test("solo paquetes publicados; sus salidas: publicadas y futuras, por fecha", async () => {
    const p = paquete(1, "publicado");
    const { svc } = servicio(
      [p, paquete(2, "borrador"), paquete(3, "archivado")],
      [
        salida(1, p.id, "publicada", 30),
        salida(2, p.id, "publicada", 10),
        salida(3, p.id, "cancelada", 20),
        salida(4, p.id, "borrador", 20),
        salida(5, p.id, "publicada", -5), // ya salió
      ],
    );
    const lista = await svc.list(AHORA);
    expect(lista.map((x) => x.name)).toEqual(["Paquete 1"]);
    expect(lista[0]!.salidas.map((s) => s.startsAt.getTime())).toEqual([
      AHORA.getTime() + 10 * DIA,
      AHORA.getTime() + 30 * DIA,
    ]);
  });

  test("un paquete publicado sin salidas futuras sigue en la lista, con salidas vacías", async () => {
    const p = paquete(1, "publicado");
    const { svc } = servicio([p], [salida(1, p.id, "cancelada", 10)]);
    expect(await svc.list(AHORA)).toMatchObject([{ id: p.id, salidas: [] }]);
  });

  test("el DTO no expone estados, marcas de tiempo ni ids de salida (y no consulta plazas)", async () => {
    const p = paquete(1, "publicado");
    const { svc, consultadas } = servicio([p], [salida(1, p.id, "publicada", 10)]);
    const [uno] = await svc.list(AHORA);
    expect(Object.keys(uno!).sort()).toEqual(["id", "name", "salidas", "summary"]);
    expect(Object.keys(uno!.salidas[0]!).sort()).toEqual([
      "adultPriceCents",
      "childPriceCents",
      "endsAt",
      "infantPriceCents",
      "startsAt",
    ]);
    expect(consultadas).toEqual([]);
  });
});

describe("PublicCatalogService.get", () => {
  test.each(["borrador", "archivado"] as const)("paquete %s → NotFoundError", async (estado) => {
    const p = paquete(1, estado);
    const { svc } = servicio([p], [salida(1, p.id, "publicada", 10)]);
    await expect(svc.get(p.id, AHORA)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("paquete inexistente → NotFoundError", async () => {
    const { svc } = servicio([], []);
    await expect(svc.get(idDe(77), AHORA)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("detalle: salidas publicadas y futuras con plazas (vía availableSeats) y nombres de puntos", async () => {
    const p = paquete(1, "publicado");
    const futura = { ...salida(1, p.id, "publicada", 10), boardingPointIds: [PUNTO_A, PUNTO_B] };
    const { svc, consultadas } = servicio(
      [p],
      [futura, salida(2, p.id, "cancelada", 12), salida(3, p.id, "publicada", -1)],
    );
    const detalle = await svc.get(p.id, AHORA);
    expect(detalle).toMatchObject({ id: p.id, name: "Paquete 1", description: "Descripción 1" });
    expect(detalle.salidas).toHaveLength(1);
    expect(detalle.salidas[0]).toMatchObject({
      adultPriceCents: 150050,
      childPriceCents: 100000,
      infantPriceCents: 0,
      availableSeats: 21,
      boardingPoints: ["Terminal Norte", "Plaza Sur"],
    });
    // Plazas solo de lo que se muestra.
    expect(consultadas).toEqual([futura.id]);
  });

  test("el DTO de detalle no expone campos internos", async () => {
    const p = paquete(1, "publicado");
    const { svc } = servicio([p], [salida(1, p.id, "publicada", 10)]);
    const detalle = await svc.get(p.id, AHORA);
    expect(Object.keys(detalle).sort()).toEqual([
      "description",
      "id",
      "name",
      "salidas",
      "summary",
    ]);
    expect(Object.keys(detalle.salidas[0]!).sort()).toEqual([
      "adultPriceCents",
      "availableSeats",
      "boardingPoints",
      "childPriceCents",
      "endsAt",
      "infantPriceCents",
      "startsAt",
    ]);
  });
});
