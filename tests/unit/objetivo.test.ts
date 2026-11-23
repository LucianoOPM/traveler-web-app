import { describe, expect, test } from "bun:test";
import { ObjetivoInvalidoError, parsearObjetivo, urlDelObjetivo } from "../../src/db/objetivo";

describe("parsearObjetivo", () => {
  test("usa private por defecto", () => {
    expect(parsearObjetivo([])).toBe("private");
  });

  test("acepta private y demo", () => {
    expect(parsearObjetivo(["private"])).toBe("private");
    expect(parsearObjetivo(["demo"])).toBe("demo");
  });

  for (const argumentos of [["test"], ["../x"], [""], ["Private"], ["private", "demo"]]) {
    test(`rechaza ${JSON.stringify(argumentos)}`, () => {
      expect(() => parsearObjetivo(argumentos)).toThrow(ObjetivoInvalidoError);
    });
  }
});

describe("urlDelObjetivo", () => {
  const config = { databaseUrl: "postgresql://a/privada", demoDatabaseUrl: "postgresql://a/demo" };

  test("elige la URL según el objetivo", () => {
    expect(urlDelObjetivo(config, "private")).toBe(config.databaseUrl);
    expect(urlDelObjetivo(config, "demo")).toBe(config.demoDatabaseUrl);
  });
});
