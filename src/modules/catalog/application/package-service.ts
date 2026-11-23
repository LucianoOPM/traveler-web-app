import { ConflictError, NotFoundError } from "../../../lib/errors";
import type { PackageRepository } from "../domain/package-repository";
import {
  comprobarArchivable,
  comprobarCrear,
  comprobarEditable,
  comprobarEliminable,
  comprobarPublicable,
  type PackageContent,
} from "../domain/package-rules";
import type { Package } from "../types";

export class PackageService {
  constructor(private readonly repo: PackageRepository) {}

  async create(entrada: Pick<PackageContent, "name"> & Partial<PackageContent>): Promise<Package> {
    comprobarCrear(entrada);
    return this.repo.create({
      name: entrada.name,
      summary: entrada.summary ?? "",
      description: entrada.description ?? "",
    });
  }

  async edit(id: string, cambios: Partial<PackageContent>): Promise<Package> {
    const paquete = await this.cargar(id);
    comprobarEditable(paquete, cambios);
    if (Object.values(cambios).every((valor) => valor === undefined)) return paquete;
    return this.cambiar(paquete, cambios);
  }

  async publish(id: string): Promise<Package> {
    const paquete = await this.cargar(id);
    comprobarPublicable(paquete);
    return this.cambiar(paquete, { status: "publicado" });
  }

  async archive(id: string): Promise<Package> {
    const paquete = await this.cargar(id);
    comprobarArchivable(paquete);
    return this.cambiar(paquete, { status: "archivado" });
  }

  async delete(id: string): Promise<void> {
    const paquete = await this.cargar(id);
    comprobarEliminable(paquete);
    if (!(await this.repo.delete(id, paquete.status))) throw cambioConcurrente();
  }

  private async cargar(id: string): Promise<Package> {
    const paquete = await this.repo.find(id);
    if (!paquete) throw new NotFoundError("Paquete no encontrado");
    return paquete;
  }

  // La actualización condicional por estado evita que dos admins pisen la misma transición.
  private async cambiar(
    paquete: Package,
    cambios: Parameters<PackageRepository["update"]>[2],
  ): Promise<Package> {
    const actualizado = await this.repo.update(paquete.id, paquete.status, cambios);
    if (!actualizado) throw cambioConcurrente();
    return actualizado;
  }
}

const cambioConcurrente = () =>
  new ConflictError("El paquete cambió mientras se procesaba la operación; inténtalo de nuevo");
