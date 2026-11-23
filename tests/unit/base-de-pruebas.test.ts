import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { asegurarBaseDePruebas } from "../support/base-de-pruebas";

const conBase = (db: unknown) => (async () => [{ db }]) as unknown as SQL;

describe("asegurarBaseDePruebas", () => {
  test("acepta traveltech_test", async () => {
    await asegurarBaseDePruebas(conBase("traveltech_test"));
  });

  test("rechaza la base privada, la demo y cualquier otra", async () => {
    for (const nombre of ["traveltech_private", "traveltech_demo", "postgres", "", null]) {
      await expect(asegurarBaseDePruebas(conBase(nombre))).rejects.toThrow("rechazada");
    }
  });
});
