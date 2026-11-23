import { NotFoundError } from "@lib/errors";
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
  /** URL del controlador de lectura (nunca la ruta del disco), o `null` sin portada. */
  portadaUrl: string | null;
  salidas: SalidaPublica[];
};
// Los ids de salida y de punto son identificadores opacos (no credenciales): el checkout los necesita.
export type SalidaDetalle = SalidaPublica & {
  id: string;
  availableSeats: number;
  boardingPoints: { id: string; name: string }[];
};
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

const urlPortada = (id: string | null) => (id ? `/api/media/${id}` : null);

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
        portadaUrl: urlPortada(p.coverAssetId),
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
      portadaUrl: urlPortada(paquete.coverAssetId),
      description: paquete.description,
      salidas: await Promise.all(proximas.map((s) => this.detalle(s, nombres))),
    };
  }

  /**
   * Salida que puede reservarse hoy, con su paquete. `NotFoundError` (404 uniforme) si no existe,
   * no está publicada, su paquete no lo está o ya empezó. Es informativa: la capacidad real la
   * decide `BookingService` dentro de su transacción.
   */
  async salidaReservable(id: string, ahora = new Date()) {
    const base = await this.departures.find(id);
    const paquete = base && (await this.packages.find(base.packageId));
    if (!base || paquete?.status !== "publicado") throw new NotFoundError("Salida no encontrada");
    const salida = (await this.proximas(base.packageId, ahora)).find((s) => s.id === id);
    if (!salida) throw new NotFoundError("Salida no encontrada");
    const nombres = new Map((await this.boardingPoints.list()).map((p) => [p.id, p.name]));
    return {
      paquete: { id: paquete.id, name: paquete.name },
      salida: await this.detalle(salida, nombres),
    };
  }

  private async detalle(
    s: DepartureWithPoints,
    nombres: Map<string, string>,
  ): Promise<SalidaDetalle> {
    return {
      ...publica(s),
      id: s.id,
      availableSeats: await this.seats.availableSeats(s.id),
      boardingPoints: s.boardingPointIds.flatMap((id) => {
        const name = nombres.get(id);
        return name ? [{ id, name }] : [];
      }),
    };
  }

  /**
   * Quién puede ver un asset: `publica` si es la portada de un paquete publicado; `privada` si el
   * paquete no lo está pero quien pide es admin; `null` (404) en cualquier otro caso.
   */
  async visibilidadPortada(
    assetId: string,
    esAdmin: boolean,
  ): Promise<"publica" | "privada" | null> {
    const paquete = await this.packages.findByCover(assetId);
    if (!paquete) return null;
    if (paquete.status === "publicado") return "publica";
    return esAdmin ? "privada" : null;
  }

  // `listByPackage` ya viene por fecha de inicio.
  private async proximas(packageId: string, ahora: Date) {
    return (await this.departures.listByPackage(packageId)).filter(
      (s) => s.status === "publicada" && s.startsAt > ahora,
    );
  }
}
