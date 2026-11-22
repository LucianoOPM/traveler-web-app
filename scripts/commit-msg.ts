/**
 * Validador de mensajes de commit (Conventional Commits). Lo usa el hook `.githooks/commit-msg`
 * y lo reutilizará la CI (issue #10). Sin dependencias.
 *
 * Solo se valida la CABECERA (primera línea que no esté vacía ni sea un comentario de Git `#`):
 * `tipo(scope)!: descripción`, con scope y `!` opcionales, scope en minúsculas, descripción no
 * vacía y como máximo 100 caracteres (caracteres Unicode, no bytes). El cuerpo y el pie se ignoran.
 *
 * Uso como programa: `bun scripts/commit-msg.ts <archivo-con-el-mensaje>` (sale con 1 si es inválido).
 */

export const TIPOS_COMMIT = [
  "feat",
  "fix",
  "chore",
  "docs",
  "test",
  "refactor",
  "style",
  "perf",
  "build",
  "ci",
  "revert",
] as const;

export const MAX_LONGITUD_CABECERA = 100;

// Cabeceras que Git genera por su cuenta o que se reescriben con `rebase --autosquash`.
const PREFIJOS_PERMITIDOS = ["Merge ", 'Revert "', "fixup! ", "squash! ", "amend! "];

const FORMATO = new RegExp(
  `^(?:${TIPOS_COMMIT.join("|")})(?:\\([a-z0-9]+(?:[-_./][a-z0-9]+)*\\))?!?: \\S`,
  "u",
);

function ayuda(): string {
  return [
    "El mensaje de commit no cumple Conventional Commits.",
    "",
    "Formato:  tipo(scope)!: descripción   (scope y ! son opcionales)",
    `Tipos:    ${TIPOS_COMMIT.join(", ")}`,
    `Cabecera: como máximo ${MAX_LONGITUD_CABECERA} caracteres; scope en minúsculas.`,
    "Ejemplos: feat(h0): añadir validación de configuración",
    "          fix: corregir el cálculo de la liquidación",
    'También se permiten: "Merge ...", \'Revert "..."\', "fixup! ...", "squash! ..." y "amend! ...".',
    "",
    "Para saltarte la validación a propósito: git commit --no-verify",
  ].join("\n");
}

function extraerCabecera(mensaje: string): string | undefined {
  for (const linea of mensaje.split("\n")) {
    const limpia = linea.replace(/\r$/, "").trimEnd();
    if (limpia.trim() === "" || limpia.startsWith("#")) continue;
    return limpia;
  }
  return undefined;
}

/** Devuelve `null` si el mensaje es válido, o el texto del error (en español) si no lo es. */
export function validarMensaje(mensaje: string): string | null {
  const cabecera = extraerCabecera(mensaje);
  if (cabecera === undefined) {
    return `El mensaje de commit está vacío.\n\n${ayuda()}`;
  }
  if (PREFIJOS_PERMITIDOS.some((prefijo) => cabecera.startsWith(prefijo))) return null;

  const longitud = [...cabecera].length;
  if (longitud > MAX_LONGITUD_CABECERA) {
    return `La cabecera mide ${longitud} caracteres y el máximo es ${MAX_LONGITUD_CABECERA}.\n\n${ayuda()}`;
  }
  if (!FORMATO.test(cabecera)) {
    return `${ayuda()}\n\nCabecera recibida: ${JSON.stringify(cabecera)}`;
  }
  return null;
}

if (import.meta.main) {
  const archivo = Bun.argv[2];
  if (!archivo) {
    console.error("Uso: bun scripts/commit-msg.ts <archivo-con-el-mensaje>");
    process.exit(2);
  }
  let texto: string;
  try {
    texto = await Bun.file(archivo).text();
  } catch {
    console.error(`No se pudo leer el archivo del mensaje: ${archivo}`);
    process.exit(2);
  }
  const error = validarMensaje(texto);
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
