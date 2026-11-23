import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Carpeta de migraciones de Drizzle (`NNNN_<nombre>.sql`, `NNNN_<nombre>.down.sql` y `meta/`). */
export const CARPETA_MIGRACIONES = path.resolve(import.meta.dir, "migrations");

export type EntradaJournal = { tag: string; when: number };

/** Entradas del journal de Drizzle en orden de aplicación; `[]` si todavía no hay migraciones. */
export function leerJournal(carpeta: string): EntradaJournal[] {
  const archivo = path.join(carpeta, "meta", "_journal.json");
  if (!existsSync(archivo)) return [];
  const journal = JSON.parse(readFileSync(archivo, "utf8")) as { entries: EntradaJournal[] };
  return journal.entries.map(({ tag, when }) => ({ tag, when }));
}

export function rutaDown(carpeta: string, tag: string): string {
  return path.join(carpeta, `${tag}.down.sql`);
}

/** Motivo de una línea `-- IRREVERSIBLE: <motivo>` (motivo no vacío); `null` si no hay marcador válido. */
export function motivoIrreversible(sqlDown: string): string | null {
  const coincidencia = /^--[ \t]*IRREVERSIBLE:[ \t]*(\S.*?)[ \t]*$/m.exec(sqlDown);
  return coincidencia?.[1] ?? null;
}

/** Quita comentarios `--` y espacios para saber si un `down` tiene SQL real. */
function tieneSql(texto: string): boolean {
  return texto.split(/\r?\n/).some((linea) => {
    const limpia = linea.trim();
    return limpia !== "" && !limpia.startsWith("--");
  });
}

/**
 * Cada migración debe ser reversible (tiene `.down.sql` con SQL) o declararse irreversible con
 * `-- IRREVERSIBLE: <motivo>`. Devuelve una descripción por cada incumplimiento.
 */
export function verificarReversibilidad(carpeta: string): string[] {
  const problemas: string[] = [];
  for (const { tag } of leerJournal(carpeta)) {
    const archivo = rutaDown(carpeta, tag);
    if (!existsSync(archivo)) {
      problemas.push(`${tag}: falta ${tag}.down.sql (o un marcador -- IRREVERSIBLE: <motivo>).`);
      continue;
    }
    const texto = readFileSync(archivo, "utf8");
    if (motivoIrreversible(texto) === null && !tieneSql(texto)) {
      problemas.push(
        `${tag}: ${tag}.down.sql no tiene SQL ni un marcador -- IRREVERSIBLE: <motivo> con motivo.`,
      );
    }
  }
  return problemas;
}
