import { describe, expect, test } from "bun:test";
import { MAX_LONGITUD_CABECERA, TIPOS_COMMIT, validarMensaje } from "../../scripts/commit-msg";

const TIPOS: string[] = [
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
];

function cabeceraDeLongitud(longitud: number, prefijo = "feat: "): string {
  return prefijo + "a".repeat(longitud - prefijo.length);
}

describe("validarMensaje", () => {
  test("acepta los 11 tipos con y sin scope", () => {
    const tipos: string[] = [...TIPOS_COMMIT];
    expect(tipos).toEqual(TIPOS);
    for (const tipo of TIPOS) {
      expect(validarMensaje(`${tipo}: descripción`)).toBeNull();
      expect(validarMensaje(`${tipo}(h0): descripción`)).toBeNull();
    }
  });

  test("acepta ! con y sin scope", () => {
    expect(validarMensaje("feat!: cambio incompatible")).toBeNull();
    expect(validarMensaje("feat(payments)!: cambio incompatible")).toBeNull();
  });

  test("acepta scopes en minúsculas sin lista cerrada", () => {
    for (const scope of ["h0", "payments", "demo", "db", "api-v1", "cualquier-cosa"]) {
      expect(validarMensaje(`fix(${scope}): x`)).toBeNull();
    }
  });

  test("acepta descripciones en español y en inglés", () => {
    expect(validarMensaje("feat: añadir validación de configuración")).toBeNull();
    expect(validarMensaje("feat: add configuration validation")).toBeNull();
  });

  test("acepta las excepciones acordadas", () => {
    const excepciones = [
      "Merge pull request #20 from LucianoOPM/feat/h0-endpoint-salud",
      "Merge branch 'x' into dev",
      'Revert "feat: añadir algo"',
      "fixup! feat: añadir algo",
      "squash! feat: añadir algo",
      "amend! feat: añadir algo",
    ];
    for (const mensaje of excepciones) expect(validarMensaje(mensaje)).toBeNull();
  });

  test("solo valida la cabecera", () => {
    const mensaje = [
      "feat: cabecera válida",
      "",
      "Cuerpo libre sin ningún formato; incluso una línea muy larga ".repeat(5),
      "",
      "pie: sin formato → tampoco se valida",
    ].join("\n");
    expect(validarMensaje(mensaje)).toBeNull();
  });

  test("ignora líneas de comentario y saltos CRLF", () => {
    expect(validarMensaje("# comentario de Git\nfeat: x")).toBeNull();
    expect(validarMensaje("# uno\n# dos\n\nfeat: x\n# otro comentario")).toBeNull();
    expect(validarMensaje("feat: x\r\n")).toBeNull();
    expect(validarMensaje("feat: x\r\n\r\ncuerpo\r\n")).toBeNull();
    // Un comentario no puede convertir en válida una cabecera que no lo es.
    expect(validarMensaje("# comentario\nmensaje malo")).not.toBeNull();
  });

  test("rechaza mensajes vacíos o solo con comentarios", () => {
    for (const mensaje of ["", "   ", "\n\n", "\r\n", "# solo comentario", "# uno\n# dos\n"]) {
      expect(validarMensaje(mensaje)).not.toBeNull();
    }
  });

  test("rechaza cabeceras mal formadas", () => {
    const invalidas = [
      "añadir cosas",
      "Feat: x",
      "FEAT: x",
      "feat:x",
      "feat: ",
      "feat:   ",
      "feature: x",
      "feat(): x",
      "feat(H0): x",
      "feat (h0): x",
      "feat(h0) : x",
      "feat(h0)x: x",
      "merge: x",
      "Mergex y",
      "Revert x",
      "fixup!x",
      "feat",
      ": x",
    ];
    for (const mensaje of invalidas) {
      expect(validarMensaje(mensaje), `debía rechazar: ${JSON.stringify(mensaje)}`).not.toBeNull();
    }
  });

  test("limita la cabecera a 100 caracteres, contados como caracteres", () => {
    expect(MAX_LONGITUD_CABECERA).toBe(100);
    expect(validarMensaje(cabeceraDeLongitud(100))).toBeNull();
    expect(validarMensaje(cabeceraDeLongitud(101))).not.toBeNull();

    // `ñ` y las vocales acentuadas ocupan 2 bytes en UTF-8: 100 caracteres siguen siendo válidos.
    const conAcentos = "feat: " + "ñáéíóú".repeat(20).slice(0, 94);
    expect([...conAcentos]).toHaveLength(100);
    expect(new TextEncoder().encode(conAcentos).length).toBeGreaterThan(100);
    expect(validarMensaje(conAcentos)).toBeNull();
    expect(validarMensaje(conAcentos + "ñ")).not.toBeNull();

    // Un carácter fuera del plano básico (emoji) cuenta como uno, no como dos.
    const conEmoji = "feat: " + "🚀".repeat(94);
    expect([...conEmoji]).toHaveLength(100);
    expect(validarMensaje(conEmoji)).toBeNull();
  });

  test("una cabecera que empieza por # no se confunde con un comentario", () => {
    // Git conserva estas líneas con \`-m\`: sin la opción, la línea siguiente haría válido el commit.
    expect(validarMensaje("#123 arreglar", { ignorarComentarios: false })).toContain(
      "#123 arreglar",
    );
    expect(validarMensaje("#123 arreglar\nfeat: y", { ignorarComentarios: false })).not.toBeNull();
    expect(validarMensaje("# comentario\nfeat: x", { ignorarComentarios: false })).not.toBeNull();
    // Con el comportamiento por defecto (hook local) los comentarios de Git se siguen ignorando.
    expect(validarMensaje("# comentario\nfeat: x")).toBeNull();
    // Y el mensaje de error explica el motivo en lugar de decir solo que está vacío.
    expect(validarMensaje("#123 arreglar")).toContain("empieza por #");
    expect(validarMensaje("# solo comentario")).toContain("empieza por #");
  });

  test("rechaza caracteres de control e invisibles en la cabecera", () => {
    const invalidas = [
      "feat: \u0001",
      "feat: x\u0000",
      "feat: \u007f",
      "feat: x\ry",
      "feat: a\tb",
      "feat: \u200b",
      "feat: \u00a0",
      "\ufefffeat: x",
    ];
    for (const mensaje of invalidas) {
      expect(validarMensaje(mensaje), "debía rechazar " + JSON.stringify(mensaje)).not.toBeNull();
    }
    // El BOM no se ve: el error lo muestra escapado para que se pueda diagnosticar.
    expect(validarMensaje("\ufefffeat: x")).toContain("\\uFEFF");
  });

  test("acepta Reapply de Git y scopes con separadores documentados", () => {
    expect(validarMensaje('Reapply "feat: añadir algo"')).toBeNull();
    for (const scope of ["a/b", "a.b", "a_b", "api-v1"]) {
      expect(validarMensaje("feat(" + scope + "): x")).toBeNull();
    }
    expect(validarMensaje("feat(A/b): x")).not.toBeNull();
  });

  test("el error es comprensible", () => {
    const error = validarMensaje("mensaje malo");
    expect(error).not.toBeNull();
    expect(error).toContain("Conventional Commits");
    for (const tipo of TIPOS) expect(error).toContain(tipo);
    expect(error).toMatch(/feat\(h0\)?: /);
    expect(validarMensaje(cabeceraDeLongitud(101))).toContain("100");
  });
});
