import { ConflictError, NotFoundError } from "../../../lib/errors";
import type { DepartureRepository } from "../domain/departure-repository";
import {
  comprobarCancelable,
  comprobarContenido,
  comprobarEliminable,
  comprobarModificable,
  comprobarPublicable,
  type DepartureContent,
} from "../domain/departure-rules";
import type { Departure } from "../types";

export class DepartureService {
  constructor(private readonly repo: DepartureRepository) {}

  async create(entrada: DepartureContent & { packageId: string }): Promise<Departure> {
    comprobarContenido(entrada);
    if ((await this.repo.findPackageStatus(entrada.packageId)) === null) {
      throw new NotFoundError("Paquete no encontrado");
    }
    return this.repo.create(entrada);
  }

  async edit(id: string, cambios: Partial<DepartureContent>): Promise<Departure> {
    const salida = await this.cargar(id);
    comprobarModificable(salida);
    // Solo los campos definidos: un `undefined` explícito no debe pisar el valor actual.
    const definidos = Object.fromEntries(
      Object.entries(cambios).filter(([, valor]) => valor !== undefined),
    ) as Partial<DepartureContent>;
    comprobarContenido({ ...salida, ...definidos });
    if (Object.keys(definidos).length === 0) return salida;
    return this.cambiar(salida, definidos);
  }

  async publish(id: string): Promise<Departure> {
    const salida = await this.cargar(id);
    // Si el paquete desapareciera (FK `restrict` lo impide) se trata como no publicado.
    const estadoPaquete = (await this.repo.findPackageStatus(salida.packageId)) ?? "borrador";
    comprobarPublicable(salida, estadoPaquete);
    return this.cambiar(salida, { status: "publicada" });
  }

  async cancel(id: string): Promise<Departure> {
    const salida = await this.cargar(id);
    comprobarCancelable(salida);
    return this.cambiar(salida, { status: "cancelada" });
  }

  async delete(id: string): Promise<void> {
    const salida = await this.cargar(id);
    comprobarEliminable(salida);
    if (!(await this.repo.delete(id, salida.status))) throw cambioConcurrente();
  }

  async assignBoardingPoint(departureId: string, boardingPointId: string): Promise<void> {
    comprobarModificable(await this.cargar(departureId));
    if (!(await this.repo.addBoardingPoint(departureId, boardingPointId))) {
      throw new ConflictError("El punto de abordaje ya está asignado a la salida");
    }
  }

  async removeBoardingPoint(departureId: string, boardingPointId: string): Promise<void> {
    comprobarModificable(await this.cargar(departureId));
    if (!(await this.repo.removeBoardingPoint(departureId, boardingPointId))) {
      throw new NotFoundError("El punto de abordaje no está asignado a la salida");
    }
  }

  /**
   * PROVISIONAL (H2): devuelve la capacidad total porque aún no existen reservas. H3 restará las
   * plazas retenidas y ocupadas (todos los pasajeros, infantes incluidos) y evitará que la
   * capacidad baje de lo retenido.
   */
  async availableSeats(id: string): Promise<number> {
    return (await this.cargar(id)).capacity;
  }

  private async cargar(id: string): Promise<Departure> {
    const salida = await this.repo.find(id);
    if (!salida) throw new NotFoundError("Salida no encontrada");
    return salida;
  }

  // La actualización condicional por estado evita que dos admins pisen la misma transición.
  private async cambiar(
    salida: Departure,
    cambios: Parameters<DepartureRepository["update"]>[2],
  ): Promise<Departure> {
    const actualizada = await this.repo.update(salida.id, salida.status, cambios);
    if (!actualizada) throw cambioConcurrente();
    return actualizada;
  }
}

const cambioConcurrente = () =>
  new ConflictError("La salida cambió mientras se procesaba la operación; inténtalo de nuevo");
