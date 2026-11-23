import type { Package, PackageStatus } from "../types";
import type { PackageContent } from "./package-rules";

// Sin lógica de permisos ni de negocio (ADR-026). `update` y `delete` son condicionales por
// estado: devuelven `null`/`false` si el paquete ya no estaba en `esperado` (cambio concurrente).
export interface PackageRepository {
  find(id: string): Promise<Package | null>;
  create(datos: PackageContent): Promise<Package>;
  update(
    id: string,
    esperado: PackageStatus,
    cambios: Partial<PackageContent> & { status?: PackageStatus },
  ): Promise<Package | null>;
  delete(id: string, esperado: PackageStatus): Promise<boolean>;
}
