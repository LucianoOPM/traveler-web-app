import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { GuardiaBaseError } from "../../src/db/guardia";
import { revertirUltimaMigracion } from "../../src/db/rollback";

/** Conexión falsa que responde `current_database()` con `base` y registra cualquier otra operación. */
function conexionFalsa(base: string) {
  const consultas: string[] = [];
  const otras: string[] = [];
  const sql = Object.assign(
    (strings: TemplateStringsArray) => {
      consultas.push(strings.join("?"));
      return Promise.resolve([{ db: base }]);
    },
    {
      begin: () => {
        otras.push("begin");
        return Promise.resolve();
      },
      unsafe: () => {
        otras.push("unsafe");
        return Promise.resolve([]);
      },
    },
  );
  return { sql: sql as unknown as SQL, consultas, otras };
}

describe("revertirUltimaMigracion: guardia", () => {
  for (const base of ["traveltech_private", "traveltech_demo", "postgres"]) {
    test(`rechaza ${base} sin ejecutar nada más que la comprobación del nombre`, async () => {
      const { sql, consultas, otras } = conexionFalsa(base);
      await expect(revertirUltimaMigracion(sql)).rejects.toBeInstanceOf(GuardiaBaseError);
      expect(consultas).toHaveLength(1);
      expect(consultas[0]).toContain("current_database()");
      expect(otras).toEqual([]);
    });
  }
});
