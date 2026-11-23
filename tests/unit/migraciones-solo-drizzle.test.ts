import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regla del responsable (ADR-023): Drizzle hace SIEMPRE las migraciones. El CLI de Better Auth
 * (`auth migrate`) no se usa nunca; como mucho `auth generate` produce el esquema de Drizzle, que
 * se revisa y se versiona, y la migración la genera `drizzle-kit`.
 */
const raiz = path.resolve(import.meta.dir, "../..");
const paquete = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const prohibido =
  /(?:\bauth(?:@[\w.-]+)?|better-auth(?:@[\w.-]+)?|@better-auth\/cli(?:@[\w.-]+)?)\s+migrate\b/;

describe("migraciones solo con Drizzle", () => {
  test("ningún script de package.json usa el migrate de Better Auth", () => {
    for (const [nombre, comando] of Object.entries(paquete.scripts)) {
      expect({ nombre, usaMigrateDeBetterAuth: prohibido.test(comando) }).toEqual({
        nombre,
        usaMigrateDeBetterAuth: false,
      });
    }
  });

  test("db:generate y db:migrate son de drizzle-kit", () => {
    expect(paquete.scripts["db:generate"]).toStartWith("drizzle-kit generate");
    expect(paquete.scripts["db:migrate"]).toStartWith("drizzle-kit migrate");
    expect(paquete.scripts["db:migrate:demo"]).toStartWith("drizzle-kit migrate");
  });

  test("la expresión prohibida detecta las formas habituales", () => {
    for (const comando of [
      "auth migrate",
      "bunx auth migrate",
      "bunx --bun auth@latest migrate",
      "better-auth migrate",
      "bunx @better-auth/cli migrate",
    ]) {
      expect(prohibido.test(comando)).toBe(true);
    }
    for (const comando of [
      "drizzle-kit migrate",
      "bunx auth generate",
      "bun scripts/db-rollback.ts",
    ]) {
      expect(prohibido.test(comando)).toBe(false);
    }
  });
});
