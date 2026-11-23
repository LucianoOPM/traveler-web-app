// Importes en pesos (texto que escribe el admin) ↔ centavos enteros. Nunca se usan floats: se
// parte el texto decimal y se compone con enteros. Los formatos ambiguos (coma, miles, signo,
// notación científica) se rechazan en lugar de adivinarse.
const MAX_CENTAVOS = 2_147_483_647; // `integer` de PostgreSQL

/** Centavos enteros ≥ 0, o `null` si el texto no es un importe válido con a lo sumo 2 decimales. */
export function pesosACentavos(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(limpio)) return null;
  const [enteros = "", decimales = ""] = limpio.split(".");
  const centavos = Number(enteros || "0") * 100 + Number(decimales.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) && centavos <= MAX_CENTAVOS ? centavos : null;
}

/** `150050` → `"1500.50"`: siempre dos decimales y sin separador de miles (válido para un input). */
export function centavosAPesos(centavos: number): string {
  return `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}
