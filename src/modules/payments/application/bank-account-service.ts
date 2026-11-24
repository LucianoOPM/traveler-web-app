import { ConflictError, NotFoundError } from "@lib/errors";
import { utcALocal } from "@lib/fechas";
import type { BankAccountRepository } from "../domain/bank-account-repository";
import {
  type DatosCuenta,
  instantanea,
  tieneAsignaciones,
  validarCuenta,
} from "../domain/bank-account-rules";
import type { BankAccount } from "../types";

const ENTIDAD = "bank_account";
const noEncontrada = () => new NotFoundError("Cuenta bancaria no encontrada");
const CAMPOS = [
  "name",
  "bankName",
  "accountHolder",
  "clabe",
  "priority",
  "monthlyLimitCents",
] as const satisfies readonly (keyof DatosCuenta)[];

export class BankAccountService {
  constructor(
    private readonly repo: BankAccountRepository,
    /** `AGENCY_TIMEZONE`: define el «mes vigente» del límite. */
    private readonly zona: string,
  ) {}

  private mesVigente() {
    return utcALocal(new Date(), this.zona).slice(0, 7);
  }

  list() {
    return this.repo.list(this.mesVigente());
  }

  async get(id: string) {
    const cuenta = await this.repo.get(id);
    if (!cuenta) throw noEncontrada();
    return cuenta;
  }

  async create(actorUserId: string, datos: DatosCuenta): Promise<BankAccount> {
    const validos = validarCuenta(datos);
    return this.repo.transaction(async (tx) => {
      const cuenta = await tx.insert(validos);
      await tx.audit({
        actorUserId,
        action: "bank_account.created",
        entityType: ENTIDAD,
        entityId: cuenta.id,
        before: null,
        after: instantanea(cuenta),
      });
      return cuenta;
    });
  }

  async edit(actorUserId: string, id: string, datos: DatosCuenta): Promise<BankAccount> {
    const validos = validarCuenta(datos);
    return this.repo.transaction(async (tx) => {
      // El bloqueo va antes de calcular lo comprometido: una asignación concurrente (que bloquea la
      // misma fila) o termina antes y se cuenta, o espera a este commit.
      const actual = await tx.lock(id);
      if (!actual) throw noEncontrada();
      // Sin cambios efectivos no se escribe ni se audita.
      if (CAMPOS.every((campo) => actual[campo] === validos[campo])) return actual;
      if (validos.monthlyLimitCents < actual.monthlyLimitCents) {
        const comprometido = await tx.committedCents(id, this.mesVigente());
        if (validos.monthlyLimitCents < comprometido) {
          throw new ConflictError(
            "El límite mensual no puede ser menor que lo comprometido por la cuenta este mes",
          );
        }
      }
      const nueva = await tx.update(id, validos);
      await tx.audit({
        actorUserId,
        action: "bank_account.updated",
        entityType: ENTIDAD,
        entityId: id,
        before: instantanea(actual),
        after: instantanea(nueva),
      });
      return nueva;
    });
  }

  /** Idempotente: repetir el mismo estado no cambia nada ni audita. */
  async setEligible(actorUserId: string, id: string, isEligible: boolean): Promise<BankAccount> {
    return this.repo.transaction(async (tx) => {
      const actual = await tx.lock(id);
      if (!actual) throw noEncontrada();
      if (actual.isEligible === isEligible) return actual;
      const nueva = await tx.update(id, { isEligible });
      await tx.audit({
        actorUserId,
        action: isEligible ? "bank_account.enabled" : "bank_account.disabled",
        entityType: ENTIDAD,
        entityId: id,
        before: instantanea(actual),
        after: instantanea(nueva),
      });
      return nueva;
    });
  }

  async delete(actorUserId: string, id: string): Promise<void> {
    await this.repo.transaction(async (tx) => {
      const actual = await tx.lock(id);
      if (!actual) throw noEncontrada();
      // Cualquier asignación (también liberada) es historial; la FK `restrict` es la última defensa.
      if (await tx.hasAllocations(id)) throw tieneAsignaciones();
      await tx.delete(id);
      await tx.audit({
        actorUserId,
        action: "bank_account.deleted",
        entityType: ENTIDAD,
        entityId: id,
        before: instantanea(actual),
        after: null,
      });
    });
  }
}
