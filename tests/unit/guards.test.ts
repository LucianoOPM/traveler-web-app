import { describe, expect, test } from "bun:test";
import { ForbiddenError, UnauthenticatedError } from "@lib/errors";
import { esAdmin, exigirAdmin } from "@lib/guards";

const con = (user: Record<string, unknown> | null | undefined) =>
  ({ user }) as Parameters<typeof exigirAdmin>[0];

describe("esAdmin", () => {
  test("sin sesión, operador, sin rol o vetado → false", () => {
    expect(esAdmin(null)).toBe(false);
    expect(esAdmin(undefined)).toBe(false);
    expect(esAdmin({ role: "operator" })).toBe(false);
    expect(esAdmin({ role: null })).toBe(false);
    expect(esAdmin({ role: "admin", banned: true })).toBe(false);
  });

  test("admin, también con varios roles → true", () => {
    expect(esAdmin({ role: "admin" })).toBe(true);
    expect(esAdmin({ role: "operator,admin" })).toBe(true);
  });
});

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
