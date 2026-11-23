import { describe, expect, test } from "bun:test";
import { ForbiddenError, UnauthenticatedError } from "../../src/lib/errors";
import { exigirAdmin } from "../../src/lib/guards";

const con = (user: Record<string, unknown> | null | undefined) =>
  ({ user }) as Parameters<typeof exigirAdmin>[0];

describe("exigirAdmin", () => {
  test("sin sesión → 401", () => {
    expect(() => exigirAdmin(con(null))).toThrow(UnauthenticatedError);
    expect(() => exigirAdmin(con(undefined))).toThrow(UnauthenticatedError);
  });

  test("operador, sin rol o vetado → 403", () => {
    expect(() => exigirAdmin(con({ role: "operator" }))).toThrow(ForbiddenError);
    expect(() => exigirAdmin(con({ role: null }))).toThrow(ForbiddenError);
    expect(() => exigirAdmin(con({ role: "admin", banned: true }))).toThrow(ForbiddenError);
  });

  test("admin, también con varios roles → permitido", () => {
    expect(() => exigirAdmin(con({ role: "admin" }))).not.toThrow();
    expect(() => exigirAdmin(con({ role: "operator,admin" }))).not.toThrow();
  });
});
