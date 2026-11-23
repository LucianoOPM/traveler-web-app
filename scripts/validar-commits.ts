/**
 * Validación de los commits de un rango (la usa el job `commits` de la CI, issue #10).
 *
 * Reutiliza `validarMensaje` de `scripts/commit-msg.ts` con `{ ignorarComentarios: false }`: los
 * mensajes ya guardados no llevan comentarios de plantilla, así que una cabecera que empieza por
 * `#` debe rechazarse. Solo se valida la cabecera; el cuerpo y el pie son libres.
 *
 * Uso como programa: `bun scripts/validar-commits.ts <sha-base> <sha-head>` (SHA completos de 40
 * caracteres). Valida los commits de `base..head`. Salida: 0 válido o rango vacío, 1 hay commits
 * inválidos, 2 uso incorrecto o fallo de `git log` (p. ej. falta historial).
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

const SHA_COMPLETO = /^[0-9a-f]{40}$/;

if (import.meta.main) {
  const [base, head] = [Bun.argv[2], Bun.argv[3]];
  if (base === undefined || head === undefined) {
    console.error("Uso: bun scripts/validar-commits.ts <sha-base> <sha-head>");
    process.exit(2);
  }
  // Solo SHA completos: un valor como `--all` no debe llegar a `git` como si fuera una opción.
  for (const [nombre, valor] of [
    ["base", base],
    ["head", head],
  ] as const) {
    if (!SHA_COMPLETO.test(valor)) {
      console.error(
        `El argumento <${nombre}> debe ser un SHA completo de 40 caracteres hexadecimales.`,
      );
      process.exit(2);
    }
  }

  const proceso = Bun.spawn(["git", "log", "--format=%H%x00%B%x1e", `${base}..${head}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [salida, errorGit, codigo] = await Promise.all([
    new Response(proceso.stdout).text(),
    new Response(proceso.stderr).text(),
    proceso.exited,
  ]);
  if (codigo !== 0) {
    console.error(
      `No se pudo ejecutar git log ${base.slice(0, 7)}..${head.slice(0, 7)} (¿falta historial? usa fetch-depth: 0):\n${errorGit.trim()}`,
    );
    process.exit(2);
  }

  const commits = analizarLog(salida);
  if (commits.length === 0) {
    console.log("No hay commits que validar en el rango.");
    process.exit(0);
  }
  const errores = validarCommits(commits);
  if (errores.length > 0) {
    console.error(
      `${errores.length} de ${commits.length} commits no cumplen Conventional Commits:\n`,
    );
    for (const error of errores) console.error(`- ${error}`);
    console.error(
      "\nFormato: tipo(scope)!: descripción. Detalle y tipos válidos: docs/04-ingenieria/09-development-guide.md",
    );
    process.exit(1);
  }
  console.log(`${commits.length} commits válidos.`);
}
