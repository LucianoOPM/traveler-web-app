import { BusinessRuleError, NotFoundError } from "@lib/errors";
import type { AlmacenArchivos } from "../domain/almacen-archivos";
import { detectarTipoEvidencia, detectarTipoImagen, EXTENSION } from "../domain/firma";
import type { MediaRepository } from "../domain/media-repository";
import type { MediaAsset } from "../types";

export const TAMANO_MAXIMO = 5 * 1024 * 1024;

export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    private readonly almacen: AlmacenArchivos,
  ) {}

  /** Valida por firma real (no por extensión ni tipo del cliente) y guarda con nombre propio. */
  async guardar(bytes: Uint8Array): Promise<MediaAsset> {
    if (bytes.length === 0) throw new BusinessRuleError("El archivo está vacío");
    if (bytes.length > TAMANO_MAXIMO) throw new BusinessRuleError("La imagen supera los 5 MiB");
    const tipo = detectarTipoImagen(bytes);
    if (!tipo) throw new BusinessRuleError("Solo se admiten imágenes JPEG, PNG o WebP válidas");

    const id = crypto.randomUUID();
    const clave = `media/${id}.${EXTENSION[tipo]}`;
    await this.almacen.guardar(clave, bytes);
    try {
      return await this.repo.create({
        id,
        storageKey: clave,
        contentType: tipo,
        sizeBytes: bytes.length,
      });
    } catch (error) {
      await this.almacen.borrar(clave);
      throw error;
    }
  }

  /**
   * Evidencia de pago (imagen o PDF de hasta 5 MiB): valida por firma y escribe SOLO el archivo, con
   * clave generada por el servidor. La fila de `media_assets` la inserta quien la usa, dentro de su
   * propia transacción; si esa operación no prospera, debe llamar a `descartar`.
   * shortcut: si el proceso muere entre escribir el archivo y confirmar la transacción queda un
   * archivo huérfano; no hay limpieza automática (se documenta, no se programa).
   */
  async almacenarEvidencia(bytes: Uint8Array) {
    if (bytes.length === 0) throw new BusinessRuleError("El archivo está vacío");
    if (bytes.length > TAMANO_MAXIMO) throw new BusinessRuleError("El archivo supera los 5 MiB");
    const tipo = detectarTipoEvidencia(bytes);
    if (!tipo) {
      throw new BusinessRuleError(
        "Solo se admiten imágenes JPEG, PNG o WebP y documentos PDF válidos",
      );
    }
    const id = crypto.randomUUID();
    const storageKey = `media/${id}.${EXTENSION[tipo]}`;
    await this.almacen.guardar(storageKey, bytes);
    return { id, storageKey, contentType: tipo, sizeBytes: bytes.length };
  }

  /** Borra un archivo escrito por `almacenarEvidencia` que no llegó a usarse. */
  descartar(storageKey: string) {
    return this.almacen.borrar(storageKey);
  }

  async abrir(id: string): Promise<{ asset: MediaAsset; bytes: Uint8Array }> {
    const asset = await this.repo.find(id);
    const bytes = asset && (await this.almacen.leer(asset.storageKey));
    if (!asset || !bytes) throw new NotFoundError("Recurso no encontrado");
    return { asset, bytes };
  }

  /** Primero el archivo y luego la fila: si algo falla, la fila sigue apuntando a lo que quedó. */
  async eliminar(id: string): Promise<void> {
    const asset = await this.repo.find(id);
    if (!asset) return;
    await this.almacen.borrar(asset.storageKey);
    await this.repo.delete(id);
  }
}
