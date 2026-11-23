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
  /** `false` si el punto ya estaba asignado; lanza `NotFoundError` si el punto no existe. */
  addBoardingPoint(departureId: string, boardingPointId: string): Promise<boolean>;
  removeBoardingPoint(departureId: string, boardingPointId: string): Promise<boolean>;
}
