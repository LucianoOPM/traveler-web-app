import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { auditEvents } from "@modules/audit/schema";
import { esErrorPg } from "@modules/catalog/infrastructure/errores-pg";
import type { BankAccountRepository, BankAccountTx } from "../domain/bank-account-repository";
import { tieneAsignaciones } from "../domain/bank-account-rules";
import { bankAccounts, bankAllocations } from "../schema";

type Tx = Parameters<Parameters<BunSQLDatabase<typeof schema>["transaction"]>[0]>[0];

const operaciones = (tx: Tx): BankAccountTx => ({
  async lock(id) {
    const [cuenta] = await tx
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, id))
      .for("update");
    return cuenta ?? null;
  },
  async insert(datos) {
    const [cuenta] = await tx.insert(bankAccounts).values(datos).returning();
    return cuenta!;
  },
  async update(id, cambios) {
    const [cuenta] = await tx
      .update(bankAccounts)
      .set(cambios)
      .where(eq(bankAccounts.id, id))
      .returning();
    return cuenta!;
  },
  async delete(id) {
    try {
      await tx.delete(bankAccounts).where(eq(bankAccounts.id, id));
    } catch (error) {
      // Solo este DELETE: un 23503 de la auditoría (actor inexistente) no debe parecer un 409.
      if (esErrorPg(error, "23503")) throw tieneAsignaciones();
      throw error;
    }
  },
  async committedCents(id, mes) {
    const [fila] = await tx
      .select({ total: sql<number>`coalesce(sum(${bankAllocations.amountCents}), 0)::int` })
      .from(bankAllocations)
      .where(
        and(
          eq(bankAllocations.bankAccountId, id),
          eq(bankAllocations.calendarMonth, mes),
          eq(bankAllocations.status, "vigente"),
        ),
      );
    return fila!.total;
  },
  async hasAllocations(id) {
    const [fila] = await tx
      .select({ id: bankAllocations.id })
      .from(bankAllocations)
      .where(eq(bankAllocations.bankAccountId, id))
      .limit(1);
    return !!fila;
  },
  async audit(evento) {
    await tx.insert(auditEvents).values(evento);
  },
});

export class DrizzleBankAccountRepository implements BankAccountRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  list(mes: string) {
    // Con una sola tabla Drizzle omite el prefijo de columna: `id` a secas sería el de la asignación.
    const comprometido = sql<number>`coalesce((
      select sum(${bankAllocations.amountCents}) from ${bankAllocations}
      where ${bankAllocations.bankAccountId} = bank_accounts.id
        and ${bankAllocations.calendarMonth} = ${mes}
        and ${bankAllocations.status} = 'vigente'), 0)::int`;
    return this.db
      .select({ ...getTableColumns(bankAccounts), committedCents: comprometido })
      .from(bankAccounts)
      .orderBy(asc(bankAccounts.priority), asc(bankAccounts.name));
  }

  async get(id: string) {
    const [cuenta] = await this.db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    return cuenta ?? null;
  }

  transaction<T>(fn: (tx: BankAccountTx) => Promise<T>) {
    return this.db.transaction((tx) => fn(operaciones(tx)));
  }
}
