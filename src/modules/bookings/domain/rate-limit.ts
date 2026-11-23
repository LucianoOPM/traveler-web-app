/** Reservas que una misma IP puede intentar por ventana (se cuentan las solicitudes con forma válida). */
export const LIMITE_RESERVAS = { max: 5, ventanaMs: 60 * 60 * 1000 };

/**
 * Límite de solicitudes por clave (la IP que da Astro) con ventana deslizante en memoria.
 * shortcut: el contador vive en el proceso, así que se reinicia al reiniciarlo y no se comparte entre
 * instancias; sustituirlo por un almacén compartido al decidir el hosting (PEN-08).
 */
export class LimiteDeSolicitudes {
  private readonly intentos = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly ventanaMs: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Registra una solicitud; `false` si la clave ya agotó su cupo en la ventana (no se registra). */
  intentar(clave: string): boolean {
    const ahora = this.ahora();
    const vigentes = (this.intentos.get(clave) ?? []).filter((t) => t > ahora - this.ventanaMs);
    const permitido = vigentes.length < this.max;
    if (permitido) vigentes.push(ahora);
    if (vigentes.length > 0) this.intentos.set(clave, vigentes);
    else this.intentos.delete(clave);
    this.podar(ahora);
    return permitido;
  }

  // Sin esto el mapa crecería con cada IP distinta: se descartan las claves sin intentos vigentes.
  private podar(ahora: number) {
    for (const [clave, tiempos] of this.intentos) {
      if (tiempos.every((t) => t <= ahora - this.ventanaMs)) this.intentos.delete(clave);
    }
  }
}
