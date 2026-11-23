// Tipo real de una imagen por sus bytes, nunca por la extensión ni por el tipo que declare el
// cliente. También exige el cierre de cada formato para descartar archivos truncados.
// shortcut: no decodifica la imagen (un archivo con firma y cierre válidos y datos corruptos pasa);
// subir a una librería de imágenes si se admiten más formatos o se redimensiona.
export const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp"] as const;
export type TipoImagen = (typeof TIPOS_IMAGEN)[number];

export const EXTENSION: Record<TipoImagen, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const empieza = (b: Uint8Array, ...bytes: number[]) => bytes.every((x, i) => b[i] === x);
const termina = (b: Uint8Array, ...bytes: number[]) =>
  bytes.every((x, i) => b[b.length - bytes.length + i] === x);
const ascii = (b: Uint8Array, desde: number, texto: string) =>
  [...texto].every((c, i) => b[desde + i] === c.charCodeAt(0));

export function detectarTipoImagen(b: Uint8Array): TipoImagen | null {
  if (b.length >= 6 && empieza(b, 0xff, 0xd8, 0xff) && termina(b, 0xff, 0xd9)) return "image/jpeg";
  if (
    b.length >= 20 &&
    empieza(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) &&
    termina(b, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82)
  ) {
    return "image/png";
  }
  if (
    b.length >= 20 &&
    ascii(b, 0, "RIFF") &&
    ascii(b, 8, "WEBP") &&
    new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true) === b.length - 8
  ) {
    return "image/webp";
  }
  return null;
}
