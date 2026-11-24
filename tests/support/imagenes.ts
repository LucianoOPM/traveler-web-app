// Imágenes mínimas (con firma y cierre válidos) para las pruebas de subida.
const texto = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
export const png = () =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
export const webp = () => {
  const cuerpo = [...texto("WEBP"), ...texto("VP8 "), 4, 0, 0, 0, 1, 2, 3, 4];
  return new Uint8Array([...texto("RIFF"), cuerpo.length, 0, 0, 0, ...cuerpo]);
};
/** Un jpeg válido relleno hasta `bytes` de tamaño. */
export const jpegDe = (bytes: number) => {
  const datos = new Uint8Array(bytes);
  datos.set(jpeg().slice(0, 4));
  datos.set([0xff, 0xd9], bytes - 2);
  return datos;
};

/** Un PDF mínimo con cabecera `%PDF-` y marcador `%%EOF` (válido solo para la comprobación básica). */
export const pdf = () =>
  new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
/** Un PDF válido relleno hasta `bytes` de tamaño exacto (el cierre queda en el último kilobyte). */
export const pdfDe = (bytes: number) => {
  const base = pdf();
  const datos = new Uint8Array(bytes).fill(0x20);
  datos.set(base.slice(0, 9));
  datos.set(base.slice(-8), bytes - 8);
  return datos;
};
