// Reglas de dominio del paquete: funciones puras que lanzan `BusinessRuleError` (422).
// Los mensajes son públicos: no incluyen valores enviados por el cliente.
import { BusinessRuleError } from "../../../lib/errors";
import type { Package } from "../types";

export type PackageContent = Pick<Package, "name" | "summary" | "description">;

const vacio = (texto: string) => texto.trim() === "";

function exigirNombre(nombre: string) {
  if (vacio(nombre)) throw new BusinessRuleError("El nombre del paquete es obligatorio");
}

function exigirCompleto({ name, summary, description }: PackageContent) {
  if (vacio(name) || vacio(summary) || vacio(description)) {
    throw new BusinessRuleError("Nombre, resumen y descripción son obligatorios");
  }
}

export function comprobarCrear({ name }: Pick<PackageContent, "name">) {
  exigirNombre(name);
}

/** Un archivado no se edita; un publicado debe conservar completos sus tres campos. */
export function comprobarEditable(paquete: Package, cambios: Partial<PackageContent>) {
  if (paquete.status === "archivado") {
    throw new BusinessRuleError("Un paquete archivado no puede editarse");
  }
  const resultado = {
    name: cambios.name ?? paquete.name,
    summary: cambios.summary ?? paquete.summary,
    description: cambios.description ?? paquete.description,
  };
  exigirNombre(resultado.name);
  if (paquete.status === "publicado") exigirCompleto(resultado);
}

export function comprobarPublicable(paquete: Package) {
  if (paquete.status !== "borrador") {
    throw new BusinessRuleError("Solo un borrador puede publicarse");
  }
  exigirCompleto(paquete);
}

export function comprobarArchivable(paquete: Package) {
  if (paquete.status !== "publicado") {
    throw new BusinessRuleError("Solo un paquete publicado puede archivarse");
  }
}

export function comprobarEliminable(paquete: Package) {
  if (paquete.status !== "borrador") {
    throw new BusinessRuleError("Solo un borrador puede eliminarse");
  }
}
