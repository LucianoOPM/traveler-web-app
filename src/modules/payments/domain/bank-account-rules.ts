import { BusinessRuleError, ConflictError } from "@lib/errors";
import type { BankAccount } from "../types";

const MAX_CENTAVOS = 2_147_483_647; // `integer` de PostgreSQL

export type DatosCuenta = {
  name: string;
  bankName: string;
  accountHolder: string;
  clabe: string;
  priority: number;
  monthlyLimitCents: number;
};

// Los mensajes son públicos: nunca incluyen la CLABE ni el titular recibidos.
const obligatorio = (valor: string, mensaje: string) => {
  const limpio = valor.trim();
  if (limpio === "") throw new BusinessRuleError(mensaje);
  return limpio;
};

/** Normaliza y valida los datos de una cuenta. La CLABE es texto de 18 dígitos (sin dígito verificador). */
export function validarCuenta(datos: DatosCuenta): DatosCuenta {
  const clabe = datos.clabe.trim();
  if (!/^\d{18}$/.test(clabe)) throw new BusinessRuleError("La CLABE debe tener 18 dígitos");
  if (!Number.isInteger(datos.priority) || datos.priority < 0 || datos.priority > MAX_CENTAVOS) {
    throw new BusinessRuleError("La prioridad debe ser un entero mayor o igual a 0");
  }
  if (
    !Number.isInteger(datos.monthlyLimitCents) ||
    datos.monthlyLimitCents <= 0 ||
    datos.monthlyLimitCents > MAX_CENTAVOS
  ) {
    throw new BusinessRuleError("El límite mensual debe ser mayor que 0");
  }
  return {
    name: obligatorio(datos.name, "El nombre de la cuenta es obligatorio"),
    bankName: obligatorio(datos.bankName, "El banco es obligatorio"),
    accountHolder: obligatorio(datos.accountHolder, "El titular es obligatorio"),
    clabe,
    priority: datos.priority,
    monthlyLimitCents: datos.monthlyLimitCents,
  };
}

/**
 * Lo único de una cuenta que entra en `audit_events`: campos permitidos explícitos, CLABE con solo
 * los últimos 4 dígitos y sin titular. Nunca se serializa la fila completa.
 */
export function instantanea(cuenta: BankAccount) {
  return {
    name: cuenta.name,
    bankName: cuenta.bankName,
    clabeUltimos4: cuenta.clabe.slice(-4),
    priority: cuenta.priority,
    monthlyLimitCents: cuenta.monthlyLimitCents,
    isEligible: cuenta.isEligible,
  };
}

export const tieneAsignaciones = () =>
  new ConflictError("La cuenta tiene asignaciones: deshabilítala en lugar de eliminarla");
