/**
 * Validador de mensajes de commit (Conventional Commits). Lo usa el hook `.githooks/commit-msg`
 * y lo reutilizará la CI (issue #10). Sin dependencias.
 *
 * Solo se valida la CABECERA (primera línea con contenido): `tipo(scope)!: descripción`, con
 * scope y `!` opcionales, scope en minúsculas (con `-`, `_`, `.` o `/` como separadores), descripción
 * visible y como máximo 100 caracteres (caracteres Unicode, no bytes). El cuerpo y el pie se ignoran.
 *
 * Comentarios de Git: por defecto se ignoran las líneas que empiezan por `#` (son los comentarios de
 * la plantilla del editor). Con `-m`/`-F` Git las conserva, así que la CI, que valida mensajes ya
 * guardados, debe llamar con `{ ignorarComentarios: false }`.
 *
 * Las cabeceras que Git genera (`Merge `, `Revert "`, `Reapply "`, `fixup! `, `squash! `, `amend! `)
 * se aceptan sin validar su contenido ni su longitud.
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

export type OpcionesValidacion = {
  /** Ignorar las líneas que empiezan por `#` (comentarios del editor de Git). Por defecto, sí. */
  ignorarComentarios?: boolean;
};

// Cabeceras que Git genera por su cuenta o que se reescriben con `rebase --autosquash`.
const PREFIJOS_PERMITIDOS = ["Merge ", 'Revert "', 'Reapply "', "fixup! ", "squash! ", "amend! "];

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

// Muestra los caracteres invisibles o de control escapados (p. ej. un BOM) para poder diagnosticarlos.
function mostrar(texto: string): string {
  const escapado = texto.replace(
    /[\p{Cc}\p{Cf}\xa0]/gu,
    (c) => `\\u${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
  );
  return JSON.stringify(escapado);
}

type Cabecera = { texto?: string; habiaComentarios: boolean };

function extraerCabecera(mensaje: string, ignorarComentarios: boolean): Cabecera {
  let habiaComentarios = false;
  for (const linea of mensaje.split("\n")) {
    const limpia = linea.replace(/\r$/, "").trimEnd();
    if (limpia.trim() === "") continue;
    if (ignorarComentarios && limpia.startsWith("#")) {
      habiaComentarios = true;
      continue;
    }
    return { texto: limpia, habiaComentarios };
  }
  return { habiaComentarios };
}

/** Devuelve `null` si el mensaje es válido, o el texto del error (en español) si no lo es. */
export function validarMensaje(mensaje: string, opciones: OpcionesValidacion = {}): string | null {
  const { texto: cabecera, habiaComentarios } = extraerCabecera(
    mensaje,
    opciones.ignorarComentarios ?? true,
  );
  if (cabecera === undefined) {
    const motivo = habiaComentarios
      ? "El mensaje solo tiene líneas de comentario: si tu cabecera empieza por # Git la trata como comentario; debe empezar por el tipo."
      : "El mensaje de commit está vacío.";
    return `${motivo}\n\n${ayuda()}`;
  }
  if (/\p{Cc}/u.test(cabecera)) {
    return `La cabecera contiene caracteres de control: ${mostrar(cabecera)}\n\n${ayuda()}`;
  }
  if (PREFIJOS_PERMITIDOS.some((prefijo) => cabecera.startsWith(prefijo))) return null;

  const longitud = [...cabecera].length;
  if (longitud > MAX_LONGITUD_CABECERA) {
    return `La cabecera mide ${longitud} caracteres y el máximo es ${MAX_LONGITUD_CABECERA}.\n\n${ayuda()}`;
  }
  if (!FORMATO.test(cabecera)) {
    return `${ayuda()}\n\nCabecera recibida: ${mostrar(cabecera)}`;
  }
  // La descripción debe tener algún carácter visible (no solo espacios ni caracteres invisibles).
  const descripcion = cabecera.slice(cabecera.indexOf(": ") + 2);
  if (!/[^\s\p{Cf}]/u.test(descripcion)) {
    return `La descripción está vacía o solo tiene caracteres invisibles: ${mostrar(cabecera)}\n\n${ayuda()}`;
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
