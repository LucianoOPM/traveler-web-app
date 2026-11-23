import { createHash, randomBytes, randomInt } from "node:crypto";

/** Token de acceso del comprador: 256 bits aleatorios. En claro solo existe en memoria. */
export const generarToken = () => randomBytes(32).toString("base64url");

/** Forma de un token generado por `generarToken`: se descarta lo demás sin tocar la base. */
export const formatoDeToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

/** Lo único que se persiste del token. */
export const hashDeToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Sin I, L, O, 0 ni 1 para que el código se lea y dicte sin confusión.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código legible `TT-XXXXXXXX`; el identificador interno sigue siendo el UUID. */
export const generarReferencia = () =>
  "TT-" + Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");
