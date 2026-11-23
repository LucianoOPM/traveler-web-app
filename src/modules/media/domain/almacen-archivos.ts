// Almacenamiento de archivos privados detrás de una clave generada por el servidor.
export interface AlmacenArchivos {
  /** Falla si la clave ya existe (no sobrescribe). */
  guardar(clave: string, bytes: Uint8Array): Promise<void>;
  /** `null` si no existe. */
  leer(clave: string): Promise<Uint8Array | null>;
  /** No falla si no existe. */
  borrar(clave: string): Promise<void>;
}
