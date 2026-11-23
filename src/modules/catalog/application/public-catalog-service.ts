import { NotFoundError } from "../../../lib/errors";
import type { BoardingPointRepository } from "../domain/boarding-point-repository";
import type { DepartureRepository, DepartureWithPoints } from "../domain/departure-repository";
import type { PackageRepository } from "../domain/package-repository";
import type { DepartureService } from "./departure-service";

// Lectura del catálogo para visitantes (#54). Los tipos son el DTO público: solo lo que el
// visitante necesita, sin estados, marcas de tiempo ni ids internos (el id del paquete es su URL).
export type SalidaPublica = {
  startsAt: Date;
  endsAt: Date;
  adultPriceCents: number;
  childPriceCents: number;
  infantPriceCents: number;
};
export type PaqueteEnLista = {
  id: string;
  name: string;
  summary: string;
  salidas: SalidaPublica[];
};
export type SalidaDetalle = SalidaPublica & { availableSeats: number; boardingPoints: string[] };
export type PaqueteDetalle = Omit<PaqueteEnLista, "salidas"> & {
  description: string;
  salidas: SalidaDetalle[];
};

const publica = (s: DepartureWithPoints): SalidaPublica => ({
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  adultPriceCents: s.adultPriceCents,
  childPriceCents: s.childPriceCents,
  infantPriceCents: s.infantPriceCents,
});

export class PublicCatalogService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly departures: DepartureRepository,
    private readonly boardingPoints: BoardingPointRepository,
    private readonly seats: Pick<DepartureService, "availableSeats">,
  ) {}

  /** Paquetes publicados con sus próximas salidas (pueden ser ninguna). */
  async list(ahora = new Date()): Promise<PaqueteEnLista[]> {
    return Promise.all(
      (await this.packages.listPublished()).map(async (p) => ({
        id: p.id,
        name: p.name,
        summary: p.summary,
        salidas: (await this.proximas(p.id, ahora)).map(publica),
      })),
    );
  }

  /** `NotFoundError` si el paquete no existe o no está publicado (no se distingue). */
  async get(id: string, ahora = new Date()): Promise<PaqueteDetalle> {
    const paquete = await this.packages.find(id);
    if (paquete?.status !== "publicado") throw new NotFoundError("Paquete no encontrado");
    const proximas = await this.proximas(id, ahora);
    const nombres = new Map((await this.boardingPoints.list()).map((p) => [p.id, p.name]));
    return {
      id: paquete.id,
      name: paquete.name,
      summary: paquete.summary,
      description: paquete.description,
      salidas: await Promise.all(
        proximas.map(async (s) => ({
          ...publica(s),
          availableSeats: await this.seats.availableSeats(s.id),
          boardingPoints: s.boardingPointIds.flatMap((p) => nombres.get(p) ?? []),
        })),
      ),
    };
  }

  // `listByPackage` ya viene por fecha de inicio.
  private async proximas(packageId: string, ahora: Date) {
    return (await this.departures.listByPackage(packageId)).filter(
      (s) => s.status === "publicada" && s.startsAt > ahora,
    );
  }
}
