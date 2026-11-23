/**
 * Validación de los commits de un rango (la usa el job `commits` de la CI, issue #10).
 *
 * Reutiliza `validarMensaje` de `scripts/commit-msg.ts` con `{ ignorarComentarios: false }`: los
 * mensajes ya guardados no llevan comentarios de plantilla, así que una cabecera que empieza por
 * `#` debe rechazarse. Solo se valida la cabecera; el cuerpo y el pie son libres.
 *
 * Este archivo solo tiene la lógica pura. El CLI (`bun scripts/validar-commits.ts <base> <head>`)
 * se añade en la misma ruta y llama a estas funciones.
 */

import { validarMensaje } from "./commit-msg";

export type CommitRango = { sha: string; mensaje: string };

const SEPARADOR_COMMIT = "\x1e";
const SEPARADOR_CAMPO = "\x00";

/** Parsea la salida de `git log --format=%H%x00%B%x1e`. Ignora registros vacíos. */
export function analizarLog(salida: string): CommitRango[] {
  const commits: CommitRango[] = [];
  for (const registro of salida.split(SEPARADOR_COMMIT)) {
    const posicion = registro.indexOf(SEPARADOR_CAMPO);
    if (posicion === -1) continue;
    // `git log` deja un salto de línea tras cada separador de registro.
    const sha = registro.slice(0, posicion).trim();
    if (sha === "") continue;
    commits.push({ sha, mensaje: registro.slice(posicion + 1) });
  }
  return commits;
}

/** Un elemento por commit inválido: `<sha7>: <primera línea del error>`. Vacío si todos son válidos. */
export function validarCommits(commits: CommitRango[]): string[] {
  const errores: string[] = [];
  for (const commit of commits) {
    const error = validarMensaje(commit.mensaje, { ignorarComentarios: false });
    if (error === null) continue;
    const primeraLinea = error.split("\n")[0] ?? error;
    const cabecera = commit.mensaje.split("\n").find((linea) => linea.trim() !== "") ?? "";
    errores.push(
      `${commit.sha.slice(0, 7)}: ${primeraLinea} Cabecera: ${JSON.stringify(cabecera.trimEnd())}`,
    );
  }
  return errores;
}
