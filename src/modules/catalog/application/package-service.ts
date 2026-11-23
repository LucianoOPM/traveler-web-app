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
import type { MediaService } from "../../media/application/media-service";
import type { Package } from "../types";

export class PackageService {
  constructor(
    private readonly repo: PackageRepository,
    private readonly media: Pick<MediaService, "guardar" | "eliminar">,
  ) {}

  list(): Promise<Package[]> {
    return this.repo.list();
  }

  get(id: string): Promise<Package> {
    return this.cargar(id);
  }

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

  /** Sube o reemplaza la portada. El archivo anterior se borra solo tras confirmar el cambio. */
  async setCover(id: string, bytes: Uint8Array): Promise<Package> {
    const paquete = await this.cargar(id);
    comprobarEditable(paquete, {});
    const nueva = await this.media.guardar(bytes);
    let actualizado: Package;
    try {
      actualizado = await this.cambiar(paquete, { coverAssetId: nueva.id });
    } catch (error) {
      await this.media.eliminar(nueva.id);
      throw error;
    }
    await this.borrarPortada(paquete.coverAssetId);
    return actualizado;
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
    await this.borrarPortada(paquete.coverAssetId);
  }

  private async cargar(id: string): Promise<Package> {
    const paquete = await this.repo.find(id);
    if (!paquete) throw new NotFoundError("Paquete no encontrado");
    return paquete;
  }

  // El cambio ya está confirmado: un fallo al borrar no debe presentarse como fallo de la operación.
  // shortcut: si falla o el proceso muere aquí queda un archivo huérfano; añadir un barrido si importa.
  private async borrarPortada(assetId: string | null) {
    if (assetId) await this.media.eliminar(assetId).catch(() => {});
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
