import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { BusinessRuleError, ConflictError, NotFoundError } from "@lib/errors";
import { BankAccountService } from "@modules/payments/application/bank-account-service";
import type { DatosCuenta } from "@modules/payments/domain/bank-account-rules";
import { DrizzleBankAccountRepository } from "@modules/payments/infrastructure/drizzle-bank-account-repository";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";
import {
  CLABE,
  mesAnterior,
  mesVigente,
  sembrarAsignacion,
  sembrarCuenta,
  TITULAR,
  ZONA,
} from "../support/cuentas";

// Reglas de cuentas bancarias con servicio y repositorio reales sobre PostgreSQL: límite frente a
// lo comprometido, deshabilitar frente a eliminar, auditoría y snapshots intactos.
const base = abrirBaseDePruebas();

describe.skipIf(!base && !process.env.CI)("cuentas bancarias: servicio y repositorio", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  const repo = new DrizzleBankAccountRepository(db);
  const servicio = new BankAccountService(repo, ZONA);
  let admin = "";
  const DESCONOCIDO = "00000000-0000-4000-8000-000000000000";

  const datos = (extra: Partial<DatosCuenta> = {}): DatosCuenta => ({
    name: "Cuenta principal",
    bankName: "Banco Ficticio",
    accountHolder: TITULAR,
    clabe: CLABE,
    priority: 1,
    monthlyLimitCents: 500_000,
    ...extra,
  });
  const auditoria = async () =>
    (await sql`select action, entity_type, entity_id, actor_user_id, before, after
      from audit_events order by created_at, id`) as Array<{
      action: string;
      entity_type: string;
      entity_id: string;
      actor_user_id: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>;
  const acciones = async () => (await auditoria()).map((e) => e.action);
  const cuentaEn = async (id: string) =>
    (await sql`select * from bank_accounts where id = ${id}`)[0] as
      { monthly_limit_cents: number; is_eligible: boolean; name: string } | undefined;

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-cuentas@example.test', now(), now()) returning id`;
    admin = u.id;
  });
  afterAll(async () => {
    await sql.close();
  });
  beforeEach(async () => {
    await sql`delete from audit_events`;
    await sql`delete from bank_allocations`;
    await sql`delete from bank_accounts`;
  });

  test("crear guarda la cuenta y audita sin CLABE completa ni titular", async () => {
    const cuenta = await servicio.create(admin, datos());
    expect(cuenta.isEligible).toBe(true);
    expect(cuenta.clabe).toBe(CLABE);

    const [evento, ...resto] = await auditoria();
    expect(resto).toHaveLength(0);
    expect(evento).toMatchObject({
      action: "bank_account.created",
      entity_type: "bank_account",
      entity_id: cuenta.id,
      actor_user_id: admin,
      before: null,
    });
    expect(evento!.after).toEqual({
      name: "Cuenta principal",
      bankName: "Banco Ficticio",
      clabeUltimos4: "4567",
      priority: 1,
      monthlyLimitCents: 500_000,
      isEligible: true,
    });
    const texto = JSON.stringify(evento);
    expect(texto).not.toContain(CLABE);
    expect(texto).not.toContain(TITULAR);
  });

  test("datos inválidos: 422, sin cuenta y sin auditoría", async () => {
    const invalidos: Array<Partial<DatosCuenta>> = [
      { clabe: "01234567890123456" }, // 17 dígitos
      { clabe: "0123456789012345678" }, // 19 dígitos
      { clabe: "01234567890123456a" },
      { name: "  " },
      { bankName: "" },
      { accountHolder: " " },
      { monthlyLimitCents: 0 },
      { monthlyLimitCents: 1.5 },
      { priority: -1 },
    ];
    for (const extra of invalidos) {
      const error = await servicio.create(admin, datos(extra)).catch((e) => e);
      expect(error, JSON.stringify(extra)).toBeInstanceOf(BusinessRuleError);
      expect(error.message).not.toContain(CLABE);
      expect(error.message).not.toContain(TITULAR);
    }
    expect(await sql`select id from bank_accounts`).toHaveLength(0);
    expect(await auditoria()).toHaveLength(0);
  });

  test("editar audita antes y después; sin cambios efectivos no escribe ni audita", async () => {
    const cuenta = await servicio.create(admin, datos());
    await servicio.edit(admin, cuenta.id, datos()); // idéntico
    expect(await acciones()).toEqual(["bank_account.created"]);

    const nueva = await servicio.edit(admin, cuenta.id, datos({ name: "Otra", priority: 3 }));
    expect(nueva.name).toBe("Otra");
    const [, editada] = await auditoria();
    expect(editada).toMatchObject({ action: "bank_account.updated", entity_id: cuenta.id });
    expect(editada!.before).toMatchObject({ name: "Cuenta principal", priority: 1 });
    expect(editada!.after).toMatchObject({ name: "Otra", priority: 3 });
  });

  test("editar una cuenta inexistente: 404", async () => {
    await expect(servicio.edit(admin, DESCONOCIDO, datos())).rejects.toBeInstanceOf(NotFoundError);
    await expect(servicio.setEligible(admin, DESCONOCIDO, false)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(servicio.delete(admin, DESCONOCIDO)).rejects.toBeInstanceOf(NotFoundError);
    await expect(servicio.get(DESCONOCIDO)).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditoria()).toHaveLength(0);
  });

  describe("límite mensual frente a lo comprometido", () => {
    test("no baja del comprometido del mes vigente; hasta el comprometido, inclusive, sí", async () => {
      const id = await sembrarCuenta(sql, { limite: 500_000 });
      await sembrarAsignacion(sql, { cuentaId: id, monto: 200_000 });
      await sembrarAsignacion(sql, { cuentaId: id, monto: 100_000 });

      const rechazo = await servicio
        .edit(admin, id, datos({ monthlyLimitCents: 299_999 }))
        .catch((e) => e);
      expect(rechazo).toBeInstanceOf(ConflictError);
      expect((await cuentaEn(id))!.monthly_limit_cents).toBe(500_000);
      expect(await auditoria()).toHaveLength(0); // lo rechazado no se audita

      await servicio.edit(admin, id, datos({ monthlyLimitCents: 300_000 }));
      expect((await cuentaEn(id))!.monthly_limit_cents).toBe(300_000);
      expect(await acciones()).toEqual(["bank_account.updated"]);
    });

    test("el comprometido excluye asignaciones liberadas y de otros meses", async () => {
      const id = await sembrarCuenta(sql, { limite: 1_000_000 });
      await sembrarAsignacion(sql, { cuentaId: id, monto: 100_000 });
      await sembrarAsignacion(sql, { cuentaId: id, monto: 400_000, estado: "liberada" });
      await sembrarAsignacion(sql, { cuentaId: id, monto: 400_000, mes: mesAnterior() });
      // Otra cuenta no cuenta para esta.
      await sembrarAsignacion(sql, { cuentaId: await sembrarCuenta(sql), monto: 400_000 });

      const [fila] = (await servicio.list()).filter((c) => c.id === id);
      expect(fila!.committedCents).toBe(100_000);

      await servicio.edit(admin, id, datos({ monthlyLimitCents: 100_000 }));
      expect((await cuentaEn(id))!.monthly_limit_cents).toBe(100_000);
    });

    test("subir el límite siempre se permite", async () => {
      const id = await sembrarCuenta(sql, { limite: 100_000 });
      await sembrarAsignacion(sql, { cuentaId: id, monto: 100_000 });
      await servicio.edit(admin, id, datos({ monthlyLimitCents: 200_000 }));
      expect((await cuentaEn(id))!.monthly_limit_cents).toBe(200_000);
    });
  });

  test("habilitar y deshabilitar auditan una vez; repetir no duplica eventos", async () => {
    const { id } = await servicio.create(admin, datos());
    await servicio.setEligible(admin, id, true); // ya estaba habilitada
    await servicio.setEligible(admin, id, false);
    await servicio.setEligible(admin, id, false);
    await servicio.setEligible(admin, id, true);
    await servicio.setEligible(admin, id, true);
    expect(await acciones()).toEqual([
      "bank_account.created",
      "bank_account.disabled",
      "bank_account.enabled",
    ]);
  });

  test("editar o deshabilitar no altera asignaciones ni snapshots emitidos", async () => {
    const id = await sembrarCuenta(sql, { limite: 500_000 });
    await sembrarAsignacion(sql, { cuentaId: id, monto: 100_000 });
    const foto = async () =>
      JSON.stringify(
        await sql`select id, bank_account_id, amount_cents, calendar_month, status,
          instruction_snapshot from bank_allocations order by id`,
      );
    const antes = await foto();

    await servicio.edit(
      admin,
      id,
      datos({
        name: "Renombrada",
        clabe: "999999999999999999",
        priority: 9,
        monthlyLimitCents: 150_000,
      }),
    );
    await servicio.setEligible(admin, id, false);

    expect(await foto()).toBe(antes);
    const [a] = await sql`select instruction_snapshot as s from bank_allocations`;
    expect(a.s).toEqual({ clabe: CLABE, accountHolder: TITULAR });
  });

  describe("eliminar", () => {
    test("sin asignaciones se elimina y la auditoría conserva el id", async () => {
      const { id } = await servicio.create(admin, datos());
      await servicio.delete(admin, id);
      expect(await cuentaEn(id)).toBeUndefined();

      const eliminado = (await auditoria()).at(-1)!;
      expect(eliminado).toMatchObject({
        action: "bank_account.deleted",
        entity_id: id,
        actor_user_id: admin,
        after: null,
      });
      expect(eliminado.before).toMatchObject({ clabeUltimos4: "4567" });
      expect(JSON.stringify(eliminado)).not.toContain(CLABE);
    });

    test("con asignación vigente o liberada: 409, la cuenta y su historial siguen", async () => {
      for (const estado of ["vigente", "liberada"] as const) {
        const id = await sembrarCuenta(sql);
        await sembrarAsignacion(sql, { cuentaId: id, monto: 1_000, estado });
        const error = await servicio.delete(admin, id).catch((e) => e);
        expect(error, estado).toBeInstanceOf(ConflictError);
        expect(error.message).toContain("deshabilítala");
        expect(await cuentaEn(id)).toBeDefined();
        expect(
          await sql`select id from bank_allocations where bank_account_id = ${id}`,
        ).toHaveLength(1);
      }
      expect(await auditoria()).toHaveLength(0);

      // Sí se puede deshabilitar.
      const [{ id }] = await sql`select id from bank_accounts limit 1`;
      await servicio.setEligible(admin, id, false);
      expect((await cuentaEn(id))!.is_eligible).toBe(false);
    });

    test("la FK es la última defensa: el repositorio traduce 23503 a 409", async () => {
      const id = await sembrarCuenta(sql);
      await sembrarAsignacion(sql, { cuentaId: id, monto: 1_000 });
      // Se salta la comprobación del servicio a propósito.
      const error = await repo.transaction((tx) => tx.delete(id)).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(await cuentaEn(id)).toBeDefined();
    });
  });

  test("si falla la auditoría se revierte el cambio de la cuenta", async () => {
    // Un actor inexistente hace fallar el INSERT de auditoría (FK) dentro de la misma transacción.
    await expect(servicio.create(DESCONOCIDO, datos())).rejects.toThrow();
    expect(await sql`select id from bank_accounts`).toHaveLength(0);

    const { id } = await servicio.create(admin, datos());
    await expect(
      servicio.edit(DESCONOCIDO, id, datos({ name: "Cambio", monthlyLimitCents: 400_000 })),
    ).rejects.toThrow();
    await expect(servicio.setEligible(DESCONOCIDO, id, false)).rejects.toThrow();
    const intacta = await cuentaEn(id);
    expect(intacta).toMatchObject({
      name: "Cuenta principal",
      monthly_limit_cents: 500_000,
      is_eligible: true,
    });

    const error = await servicio.delete(DESCONOCIDO, id).catch((e) => e);
    expect(error).not.toBeInstanceOf(ConflictError); // la FK de la auditoría no se disfraza de 409
    expect(await cuentaEn(id)).toBeDefined();
    expect(await acciones()).toEqual(["bank_account.created"]);
  });
});
