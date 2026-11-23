import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CARPETA_MIGRACIONES,
  leerJournal,
  motivoIrreversible,
  rutaDown,
  verificarReversibilidad,
} from "../../src/db/migraciones";

const temporales: string[] = [];

/** Crea una carpeta de migraciones con las entradas dadas: tag -> contenido del down (o null si no existe). */
function carpeta(migraciones: Record<string, string | null>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "traveltech-migraciones-"));
  temporales.push(dir);
  const tags = Object.keys(migraciones);
  if (tags.length > 0) {
    mkdirSync(path.join(dir, "meta"));
    const entries = tags.map((tag, idx) => ({
      idx,
      version: "7",
      when: 1700000000000 + idx,
      tag,
      breakpoints: true,
    }));
    writeFileSync(
      path.join(dir, "meta", "_journal.json"),
      JSON.stringify({ version: "7", dialect: "postgresql", entries }),
    );
  }
  for (const tag of tags) {
    writeFileSync(path.join(dir, `${tag}.sql`), "select 1;");
    const down = migraciones[tag];
    if (down !== null && down !== undefined) writeFileSync(rutaDown(dir, tag), down);
  }
  return dir;
}

afterEach(() => {
  for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("leerJournal", () => {
  test("devuelve una lista vacía sin journal", () => {
    expect(leerJournal(carpeta({}))).toEqual([]);
  });

  test("devuelve tag y when de cada entrada", () => {
    const dir = carpeta({ "0000_a": "drop table a;", "0001_b": "drop table b;" });
    expect(leerJournal(dir)).toEqual([
      { tag: "0000_a", when: 1700000000000 },
      { tag: "0001_b", when: 1700000000001 },
    ]);
  });
});

describe("rutaDown", () => {
  test("termina en <tag>.down.sql", () => {
    expect(path.basename(rutaDown("/x", "0000_identidad"))).toBe("0000_identidad.down.sql");
  });
});

describe("motivoIrreversible", () => {
  test("devuelve el motivo del marcador", () => {
    expect(motivoIrreversible("-- IRREVERSIBLE: pierde datos")).toBe("pierde datos");
    expect(motivoIrreversible("-- nota\n--   IRREVERSIBLE:   pierde datos  \nselect 1;")).toBe(
      "pierde datos",
    );
  });

  test("ignora marcadores sin motivo, en minúsculas o inexistentes", () => {
    for (const texto of [
      "-- IRREVERSIBLE:",
      "-- IRREVERSIBLE:   ",
      "-- irreversible: x",
      "DROP TABLE x;",
    ]) {
      expect(motivoIrreversible(texto)).toBeNull();
    }
  });
});

describe("verificarReversibilidad", () => {
  test("sin journal no hay problemas", () => {
    expect(verificarReversibilidad(carpeta({}))).toEqual([]);
  });

  test("acepta un down con SQL y uno con solo el marcador", () => {
    const dir = carpeta({
      "0000_a": 'DROP TABLE "a";',
      "0001_b": "-- IRREVERSIBLE: borra columnas con datos",
    });
    expect(verificarReversibilidad(dir)).toEqual([]);
  });

  test("detecta un down ausente", () => {
    const problemas = verificarReversibilidad(carpeta({ "0000_a": null }));
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("0000_a");
  });

  test("detecta un down vacío, solo con comentarios o con marcador sin motivo", () => {
    for (const down of ["", "  \n", "-- nada que revertir", "-- IRREVERSIBLE:"]) {
      const problemas = verificarReversibilidad(carpeta({ "0000_a": down }));
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toContain("0000_a");
    }
  });

  test("la carpeta real de migraciones cumple la regla", () => {
    expect(verificarReversibilidad(CARPETA_MIGRACIONES)).toEqual([]);
  });
});
