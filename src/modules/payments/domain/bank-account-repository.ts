import type { NewAuditEvent } from "@modules/audit/types";
import type { BankAccount } from "../types";
import type { DatosCuenta } from "./bank-account-rules";

export type CuentaConComprometido = BankAccount & { committedCents: number };

/** Operaciones dentro de una transacción. Todas usan la misma conexión. */
export interface BankAccountTx {
  /** `SELECT … FOR UPDATE` de la cuenta (mismo protocolo que usará la asignación); `null` si no existe. */
  lock(id: string): Promise<BankAccount | null>;
  insert(datos: DatosCuenta): Promise<BankAccount>;
  update(
    id: string,
    cambios: Partial<DatosCuenta> & { isEligible?: boolean },
  ): Promise<BankAccount>;
  /** Lanza `ConflictError` si la FK de las asignaciones lo impide (última defensa). */
  delete(id: string): Promise<void>;
  /** Suma de asignaciones `vigente` de la cuenta en el mes `YYYY-MM`. */
  committedCents(id: string, mes: string): Promise<number>;
  /** Cualquier asignación, también liberada. */
  hasAllocations(id: string): Promise<boolean>;
  audit(evento: NewAuditEvent): Promise<void>;
}

export interface BankAccountRepository {
  /** Por prioridad y nombre, con lo comprometido del mes `YYYY-MM`. */
  list(mes: string): Promise<CuentaConComprometido[]>;
  get(id: string): Promise<BankAccount | null>;
  transaction<T>(fn: (tx: BankAccountTx) => Promise<T>): Promise<T>;
}
