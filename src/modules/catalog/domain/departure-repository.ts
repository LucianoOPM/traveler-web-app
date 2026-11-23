import type { Departure, DepartureStatus, PackageStatus } from "../types";
import type { DepartureContent } from "./departure-rules";

export type DepartureWithPoints = Departure & { boardingPointIds: string[] };

// Sin lógica de permisos ni de negocio (ADR-026). `update` y `delete` son condicionales por
// estado: devuelven `null`/`false` si la salida ya no estaba en `esperado` (cambio concurrente).
// `update` bloquea la salida (el mismo `FOR UPDATE` que la reserva) y llama a `comprobar` con la fila
// bloqueada y los pasajeros retenidos calculados en esa transacción; si lanza, no se escribe nada.
export interface DepartureRepository {
  find(id: string): Promise<Departure | null>;
  findPackageStatus(packageId: string): Promise<PackageStatus | null>;
  /** Salidas del paquete por fecha de inicio, cada una con los ids de sus puntos de abordaje. */
  listByPackage(packageId: string): Promise<DepartureWithPoints[]>;
  create(datos: DepartureContent & { packageId: string }): Promise<Departure>;
  update(
    id: string,
    esperado: DepartureStatus,
    cambios: Partial<DepartureContent> & { status?: DepartureStatus },
    comprobar: (actual: Departure, retenidos: number) => void,
  ): Promise<Departure | null>;
  /** Pasajeros que ocupan lugar ahora (lectura sin bloqueo; para mostrar disponibilidad). */
  retenidos(id: string, ahora: Date): Promise<number>;
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
