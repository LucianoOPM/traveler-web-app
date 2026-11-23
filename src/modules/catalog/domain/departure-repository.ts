import type { Departure, DepartureStatus, PackageStatus } from "../types";
import type { DepartureContent } from "./departure-rules";

// Sin lógica de permisos ni de negocio (ADR-026). `update` y `delete` son condicionales por
// estado: devuelven `null`/`false` si la salida ya no estaba en `esperado` (cambio concurrente).
export interface DepartureRepository {
  find(id: string): Promise<Departure | null>;
  findPackageStatus(packageId: string): Promise<PackageStatus | null>;
  create(datos: DepartureContent & { packageId: string }): Promise<Departure>;
  update(
    id: string,
    esperado: DepartureStatus,
    cambios: Partial<DepartureContent> & { status?: DepartureStatus },
  ): Promise<Departure | null>;
  delete(id: string, esperado: DepartureStatus): Promise<boolean>;
  /** Lanza `NotFoundError` si el punto no existe. */
  addBoardingPoint(departureId: string, boardingPointId: string): Promise<ResultadoPunto>;
  removeBoardingPoint(departureId: string, boardingPointId: string): Promise<ResultadoPunto>;
}

/**
 * Resultado de asignar o quitar un punto. La salida se bloquea y su estado se comprueba dentro de
 * la misma transacción que la escritura: `cancelada` significa que ya lo estaba al escribir;
 * `sin_cambio`, que el punto ya estaba asignado (al asignar) o no lo estaba (al quitar).
 */
export type ResultadoPunto = "ok" | "sin_cambio" | "cancelada" | "inexistente";
