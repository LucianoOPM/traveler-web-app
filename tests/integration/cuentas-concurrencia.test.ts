import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import * as esquema from "@db/schema";
import { ConflictError } from "@lib/errors";
import { BankAccountService } from "@modules/payments/application/bank-account-service";
import { DrizzleBankAccountRepository } from "@modules/payments/infrastructure/drizzle-bank-account-repository";
import { bankAccounts, bankAllocations } from "@modules/payments/schema";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";
import {
  CLABE,
  mesVigente,
  sembrarCuenta,
  sembrarReserva,
  TITULAR,
  ZONA,
} from "../support/cuentas";

// Concurrencia REAL con conexiones independientes (un `SQL` por contendiente), como en H3. Mientras
// no exista el servicio de asignación, la transacción competidora sigue su protocolo (ADR-029):
// `FOR UPDATE` de la cuenta, comprobar el límite y crear la asignación vigente. Cuando exista, estas
// pruebas deben repetirse con el servicio real.
const base = abrirBaseDePruebas();
const ESPERA_MAX_MS = 10_000;
const RONDAS = 10;

describe.skipIf(!base && !process.env.CI)("cuentas bancarias: concurrencia", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  const abiertos: SQL[] = [];
  let admin = "";

  const abrirPropia = () => {
    const cliente = new SQL({ url: process.env.TEST_DATABASE_URL!, max: 2 });
    abiertos.push(cliente);
    return { sql: cliente, db: drizzle({ client: cliente, schema: esquema }) };
  };
  /** Cierra las conexiones propias abiertas desde `desde`: PostgreSQL limita los clientes. */
  const cerrarDesde = (desde: number) =>
    Promise.allSettled(abiertos.splice(desde).map((s) => s.close()));
  const clientePropio = () =>
    new BankAccountService(new DrizzleBankAccountRepository(abrirPropia().db), ZONA);

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-cuentas-concurrencia@example.test', now(), now()) returning id`;
    admin = u.id;
  });
  afterAll(async () => {
    await Promise.allSettled(abiertos.map((s) => s.close()));
    await sql.close();
  });

  const datos = (monthlyLimitCents: number) => ({
    name: "Cuenta",
    bankName: "Banco Ficticio",
    accountHolder: TITULAR,
    clabe: CLABE,
    priority: 1,
    monthlyLimitCents,
  });
  const limiteDe = async (id: string) =>
    (await sql`select monthly_limit_cents as n from bank_accounts where id = ${id}`)[0].n as number;
  const comprometido = async (id: string) =>
    (
      await sql`select coalesce(sum(amount_cents), 0)::int as n from bank_allocations
        where bank_account_id = ${id} and status = 'vigente'`
    )[0].n as number;

  const esperarBloqueados = async (n: number) => {
    const fin = Date.now() + ESPERA_MAX_MS;
    while (Date.now() < fin) {
      const [f] = await sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and state = 'active' and wait_event_type = 'Lock'`;
      if (f.n >= n) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Se esperaban ${n} sesiones bloqueadas y no llegaron en ${ESPERA_MAX_MS} ms`);
  };

  /** Protocolo de asignación: bloquea la cuenta, comprueba el límite y asigna. `false` si no cabe. */
  const asignar = (
    propia: ReturnType<typeof abrirPropia>,
    cuentaId: string,
    reservaId: string,
    monto: number,
  ) =>
    propia.db.transaction(async (tx) => {
      const [cuenta] = await tx
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.id, cuentaId))
        .for("update");
      const filas = await tx
        .select({ monto: bankAllocations.amountCents })
        .from(bankAllocations)
        .where(
          and(
            eq(bankAllocations.bankAccountId, cuentaId),
            eq(bankAllocations.calendarMonth, mesVigente()),
            eq(bankAllocations.status, "vigente"),
          ),
        );
      const usado = filas.reduce((suma, f) => suma + f.monto, 0);
      if (usado + monto > cuenta!.monthlyLimitCents) return false;
      await tx.insert(bankAllocations).values({
        bookingId: reservaId,
        bankAccountId: cuentaId,
        amountCents: monto,
        calendarMonth: mesVigente(),
        instructionSnapshot: { clabe: CLABE },
      });
      return true;
    });

  /**
   * Compuerta: una conexión propia mantiene el bloqueo de la cuenta y confirma una asignación al
   * soltarse. Las operaciones del servicio se lanzan con la cuenta bloqueada, se espera (con
   * `pg_stat_activity`) a que de verdad estén bloqueadas y solo entonces se libera.
   */
  async function conAsignacionEnCurso<T>(
    cuentaId: string,
    monto: number,
    operacion: () => Promise<T>,
  ): Promise<PromiseSettledResult<T>> {
    const reservaId = await sembrarReserva(sql, monto);
    const propia = abrirPropia();
    let soltar!: () => void;
    const puerta = new Promise<void>((r) => (soltar = r));
    let tomada!: () => void;
    const lista = new Promise<void>((r) => (tomada = r));
    const terminada = propia.db.transaction(async (tx) => {
      await tx.select().from(bankAccounts).where(eq(bankAccounts.id, cuentaId)).for("update");
      tomada();
      await puerta;
      await tx.insert(bankAllocations).values({
        bookingId: reservaId,
        bankAccountId: cuentaId,
        amountCents: monto,
        calendarMonth: mesVigente(),
        instructionSnapshot: { clabe: CLABE },
      });
    });
    await lista;
    const pendiente = Promise.allSettled([operacion()]).then(([r]) => r!);
    await esperarBloqueados(1);
    soltar();
    await terminada;
    return pendiente;
  }

  test("bajar el límite espera a una asignación en curso y la cuenta como comprometida", async () => {
    const id = await sembrarCuenta(sql, { limite: 500_000 });
    const servicio = clientePropio();
    const r = await conAsignacionEnCurso(id, 300_000, () =>
      servicio.edit(admin, id, datos(200_000)),
    );
    expect(r.status).toBe("rejected");
    expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await limiteDe(id)).toBe(500_000);
  });

  test("bajar el límite tras una asignación en curso que sí cabe se aplica", async () => {
    const id = await sembrarCuenta(sql, { limite: 500_000 });
    const servicio = clientePropio();
    const r = await conAsignacionEnCurso(id, 100_000, () =>
      servicio.edit(admin, id, datos(200_000)),
    );
    expect(r.status).toBe("fulfilled");
    expect(await limiteDe(id)).toBe(200_000);
    expect(await comprometido(id)).toBe(100_000);
  });

  test("eliminar espera a una asignación en curso y se rechaza con 409", async () => {
    const id = await sembrarCuenta(sql);
    const servicio = clientePropio();
    const r = await conAsignacionEnCurso(id, 50_000, () => servicio.delete(admin, id));
    expect(r.status).toBe("rejected");
    expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect((await sql`select id from bank_accounts where id = ${id}`).length).toBe(1);
    expect(await comprometido(id)).toBe(50_000);
  });

  test(`rondas: asignaciones y bajadas de límite simultáneas nunca dejan comprometido > límite (${RONDAS})`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const abiertasAntes = abiertos.length;
      const id = await sembrarCuenta(sql, { limite: 500_000 });
      const reservas = await Promise.all(
        Array.from({ length: 6 }, () => sembrarReserva(sql, 100_000)),
      );
      const servicio = clientePropio();
      const operaciones: Promise<unknown>[] = reservas.map((reserva) =>
        asignar(abrirPropia(), id, reserva, 100_000),
      );
      // La bajada compite con las asignaciones; puede ganar o perder según el orden de llegada.
      operaciones.splice(ronda % operaciones.length, 0, servicio.edit(admin, id, datos(250_000)));
      const resultados = await Promise.allSettled(operaciones);
      for (const r of resultados) {
        if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
      }
      const limite = await limiteDe(id);
      expect(await comprometido(id), `ronda ${ronda}`).toBeLessThanOrEqual(limite);
      await cerrarDesde(abiertasAntes);
    }
  }, 60_000);
});
