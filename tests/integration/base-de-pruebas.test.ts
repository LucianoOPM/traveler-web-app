import { afterAll, describe, expect, test } from "bun:test";
import { abrirBase } from "../../src/db/conexion";
import { asegurarBaseDePruebas } from "../support/base-de-pruebas";

const urlDePruebas = process.env.TEST_DATABASE_URL;
const conexiones: Array<ReturnType<typeof abrirBase>["sql"]> = [];

/** Conecta al mismo servidor que `TEST_DATABASE_URL` cambiando solo el nombre de la base. */
function abrirComo(nombreDeBase: string) {
  if (!urlDePruebas)
    throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
  const url = new URL(urlDePruebas);
  url.pathname = `/${nombreDeBase}`;
  const { sql } = abrirBase(url.toString());
  conexiones.push(sql);
  return sql;
}

// En local se omite sin TEST_DATABASE_URL; en CI (CI=true) corre siempre y falla si falta.
describe.skipIf(!urlDePruebas && !process.env.CI)(
  "asegurarBaseDePruebas con PostgreSQL real",
  () => {
    afterAll(() => Promise.all(conexiones.map((sql) => sql.close())));

    test("acepta traveltech_test", async () => {
      await asegurarBaseDePruebas(abrirComo("traveltech_test"));
    });

    test.each(["traveltech_private", "traveltech_demo"])("rechaza %s", async (nombre) => {
      await expect(asegurarBaseDePruebas(abrirComo(nombre))).rejects.toThrow("rechazada");
    });
  },
);
