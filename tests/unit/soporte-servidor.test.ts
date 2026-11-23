import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lanzar } from "../support/servidor";

const guion = String.raw`
  const bloque = "x".repeat(1024 * 1024);
  for (let i = 0; i < 5; i++) process.stdout.write(bloque + "\n");
  process.stderr.write("ó".repeat(100000) + "\n");
  process.stdout.write("FIN\n");
`;

let carpeta = "";

afterAll(async () => {
  if (carpeta) await rm(carpeta, { recursive: true, force: true });
});

describe("lanzar (utilidad de pruebas)", () => {
  test("salida() está completa cuando salio resuelve", async () => {
    carpeta = await mkdtemp(path.join(tmpdir(), "traveltech-soporte-"));
    const archivo = path.join(carpeta, "salida-grande.ts");
    await Bun.write(archivo, guion);
    for (let intento = 0; intento < 5; intento++) {
      const proceso = lanzar(["bun", archivo], { cwd: process.cwd(), env: process.env });
      const codigo = await proceso.salio;
      expect(codigo).toBe(0);
      const salida = proceso.salida();
      expect(salida.split("x").length - 1).toBe(5 * 1024 * 1024);
      expect(salida.split("ó").length - 1).toBe(100000);
      expect(salida).toContain("FIN\n");
    }
  }, 60_000);
});
