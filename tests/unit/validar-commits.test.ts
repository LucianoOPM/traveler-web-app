import { describe, expect, test } from "bun:test";
import { analizarLog, validarCommits } from "../../scripts/validar-commits";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

describe("analizarLog", () => {
  test("separa los commits de la salida de git log", () => {
    const salida = `${SHA_A}\x00feat: a\n\n\x1e\n${SHA_B}\x00fix: b\n\x1e\n`;
    const commits = analizarLog(salida);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({ sha: SHA_A, mensaje: "feat: a\n\n" });
    expect(commits[1]).toEqual({ sha: SHA_B, mensaje: "fix: b\n" });
  });

  test("una salida vacía no tiene commits", () => {
    expect(analizarLog("")).toEqual([]);
    expect(analizarLog("\n")).toEqual([]);
  });
});

describe("validarCommits", () => {
  test("acepta un commit válido", () => {
    expect(validarCommits([{ sha: SHA_A, mensaje: "feat(h0): ok" }])).toEqual([]);
  });

  test("reporta cada commit inválido con su SHA corto", () => {
    const errores = validarCommits([
      { sha: SHA_A, mensaje: "feat: válido" },
      { sha: SHA_B, mensaje: "arreglos varios" },
      { sha: SHA_C, mensaje: "Feat: x" },
    ]);
    expect(errores).toHaveLength(2);
    expect(errores[0]?.startsWith(`${SHA_B.slice(0, 7)}: `)).toBe(true);
    expect(errores[1]?.startsWith(`${SHA_C.slice(0, 7)}: `)).toBe(true);
    expect(errores.join("\n")).not.toContain(SHA_A.slice(0, 7));
  });

  test("una cabecera que empieza por # no es un comentario en commits ya guardados", () => {
    expect(validarCommits([{ sha: SHA_A, mensaje: "# 12 arreglar" }])).toHaveLength(1);
  });

  test("acepta mensajes con finales de línea CRLF", () => {
    expect(validarCommits([{ sha: SHA_A, mensaje: "feat: con crlf\r\n\r\ncuerpo\r\n" }])).toEqual(
      [],
    );
  });

  test("acepta los merges de GitHub", () => {
    expect(
      validarCommits([{ sha: SHA_A, mensaje: "Merge pull request #1 from a/b\n\nfeat: x" }]),
    ).toEqual([]);
  });

  test("el error incluye la cabecera rechazada para poder localizarla", () => {
    const [error] = validarCommits([{ sha: SHA_A, mensaje: "arreglos varios\n\ncuerpo" }]);
    expect(error).toContain('"arreglos varios"');
  });

  test("cada error ocupa una sola línea", () => {
    const [error] = validarCommits([{ sha: SHA_A, mensaje: "arreglos varios" }]);
    expect(error).toBeDefined();
    expect(error).not.toContain("\n");
  });
});
