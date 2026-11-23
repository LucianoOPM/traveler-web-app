import { describe, expect, test } from "bun:test";
import {
  comprobarArchivable,
  comprobarCrear,
  comprobarEditable,
  comprobarEliminable,
  comprobarPublicable,
} from "../../../src/modules/catalog/domain/package-rules";
import { BusinessRuleError } from "../../../src/lib/errors";
import type { Package, PackageStatus } from "../../../src/modules/catalog/types";

const paquete = (status: PackageStatus, cambios: Partial<Package> = {}): Package => ({
  id: "5f1c1c0e-0000-4000-8000-000000000001",
  name: "Cancún",
  summary: "Resumen",
  description: "Descripción",
  status,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...cambios,
});

describe("crear", () => {
  test("exige nombre no vacío", () => {
    expect(() => comprobarCrear({ name: "  " })).toThrow(BusinessRuleError);
    expect(() => comprobarCrear({ name: "Cancún" })).not.toThrow();
  });
});

describe("editar", () => {
  test("un borrador admite campos vacíos salvo el nombre", () => {
    const borrador = paquete("borrador");
    expect(() => comprobarEditable(borrador, { summary: "", description: "" })).not.toThrow();
    expect(() => comprobarEditable(borrador, { name: "" })).toThrow(BusinessRuleError);
  });

  test("un publicado conserva sus tres campos no vacíos", () => {
    const publicado = paquete("publicado");
    expect(() => comprobarEditable(publicado, { summary: "Nuevo" })).not.toThrow();
    for (const campo of ["name", "summary", "description"] as const) {
      expect(() => comprobarEditable(publicado, { [campo]: " " })).toThrow(BusinessRuleError);
    }
  });

  test("un archivado no se edita", () => {
    expect(() => comprobarEditable(paquete("archivado"), { name: "Otro" })).toThrow(
      BusinessRuleError,
    );
  });
});

describe("publicar", () => {
  test("solo desde borrador y con los tres campos completos", () => {
    expect(() => comprobarPublicable(paquete("borrador"))).not.toThrow();
    expect(() => comprobarPublicable(paquete("publicado"))).toThrow(BusinessRuleError);
    expect(() => comprobarPublicable(paquete("archivado"))).toThrow(BusinessRuleError);
    for (const campo of ["name", "summary", "description"] as const) {
      expect(() => comprobarPublicable(paquete("borrador", { [campo]: "" }))).toThrow(
        BusinessRuleError,
      );
    }
  });
});

describe("archivar y eliminar", () => {
  test("archivar solo desde publicado", () => {
    expect(() => comprobarArchivable(paquete("publicado"))).not.toThrow();
    expect(() => comprobarArchivable(paquete("borrador"))).toThrow(BusinessRuleError);
    expect(() => comprobarArchivable(paquete("archivado"))).toThrow(BusinessRuleError);
  });

  test("eliminar solo desde borrador", () => {
    expect(() => comprobarEliminable(paquete("borrador"))).not.toThrow();
    expect(() => comprobarEliminable(paquete("publicado"))).toThrow(BusinessRuleError);
    expect(() => comprobarEliminable(paquete("archivado"))).toThrow(BusinessRuleError);
  });
});
