import { describe, expect, test } from "bun:test";
import {
  asegurarBaseDePruebas,
  BASE_DE_PRUEBAS,
  GuardiaBaseError,
  type ConsultaSql,
} from "../../src/db/guardia";

function sqlFalso(respuesta: unknown): { sql: ConsultaSql; consultas: string[] } {
  const consultas: string[] = [];
  const sql: ConsultaSql = (strings) => {
    consultas.push(strings.join("?"));
    return Promise.resolve(respuesta as Array<Record<string, unknown>>);
  };
  return { sql, consultas };
}

describe("asegurarBaseDePruebas", () => {
  test("acepta traveltech_test y consulta current_database()", async () => {
    const { sql, consultas } = sqlFalso([{ db: "traveltech_test" }]);
    await asegurarBaseDePruebas(sql);
    expect(BASE_DE_PRUEBAS).toBe("traveltech_test");
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toContain("current_database()");
  });

  const rechazadas = [
    "traveltech_private",
    "traveltech_demo",
    "postgres",
    "traveltech_test_2",
    "Traveltech_Test",
    "",
    null,
    undefined,
  ];
  for (const nombre of rechazadas) {
    test(`rechaza la base ${JSON.stringify(nombre)}`, async () => {
      const { sql } = sqlFalso([{ db: nombre }]);
      await expect(asegurarBaseDePruebas(sql)).rejects.toBeInstanceOf(GuardiaBaseError);
    });
  }

  test("rechaza si la consulta devuelve una lista vacía", async () => {
    const { sql } = sqlFalso([]);
    await expect(asegurarBaseDePruebas(sql)).rejects.toBeInstanceOf(GuardiaBaseError);
  });

  test("rechaza si la consulta lanza", async () => {
    const sql: ConsultaSql = () => Promise.reject(new Error("conexión caída"));
    await expect(asegurarBaseDePruebas(sql)).rejects.toBeInstanceOf(GuardiaBaseError);
  });
});
