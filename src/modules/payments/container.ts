import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { BankAccountService } from "./application/bank-account-service";
import { DrizzleBankAccountRepository } from "./infrastructure/drizzle-bank-account-repository";

/** Único sitio que conoce las clases concretas del módulo. La base la elige el servidor. */
export function crearPagos(db: BunSQLDatabase<typeof schema>) {
  // Ya validada al arrancar (`comprobarConfiguracion`).
  const zona = process.env.AGENCY_TIMEZONE!;
  return { bankAccounts: new BankAccountService(new DrizzleBankAccountRepository(db), zona) };
}
