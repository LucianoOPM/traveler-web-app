import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { ConflictError, NotFoundError } from "@lib/errors";
import { generarToken } from "@modules/bookings/domain/access-token";
import { BookingService } from "@modules/bookings/application/booking-service";
import { DrizzleBookingRepository } from "@modules/bookings/infrastructure/drizzle-booking-repository";
import { BankAccountService } from "@modules/payments/application/bank-account-service";
import { BankAllocationService } from "@modules/payments/application/bank-allocation-service";
import { DrizzleBankAccountRepository } from "@modules/payments/infrastructure/drizzle-bank-account-repository";
import { DrizzleBankAllocationRepository } from "@modules/payments/infrastructure/drizzle-bank-allocation-repository";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";
import {
  CLABE,
  sembrarAsignacionDe,
  sembrarCuenta,
  sembrarReporte,
  sembrarReservaConToken,
  TITULAR,
  ZONA,
} from "../support/cuentas";

// Servicio de asignación con PostgreSQL real (una sola conexión; la concurrencia está en
// `asignacion-concurrencia.test.ts`).
const base = abrirBaseDePruebas();

describe.skipIf(!base && !process.env.CI)("asignación bancaria: servicio", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  let admin = "";
  let ahora = new Date();
  const repo = new DrizzleBankAllocationRepository(db);
  const asignaciones = new BankAllocationService(repo, ZONA, () => ahora);
  const reservas = new BookingService(new DrizzleBookingRepository(db), {
    holdHours: 24,
    ahora: () => ahora,
  });
  const cuentas = new BankAccountService(new DrizzleBankAccountRepository(db), ZONA);

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-asignacion@example.test', now(), now()) returning id`;
    admin = u.id;
  });
  // Cada prueba parte de cero cuentas: la elección depende de todas las elegibles.
  beforeEach(async () => {
    ahora = new Date();
    await sql`delete from audit_events`;
    await sql`delete from payment_reports`;
    await sql`delete from admin_cases`;
    await sql`delete from bank_allocations`;
    await sql`delete from bank_accounts`;
  });
  afterAll(async () => {
    await sql.close();
  });

  const cuenta = (campos: Parameters<typeof sembrarCuenta>[1] = {}) => sembrarCuenta(sql, campos);
  const n = async (consulta: Promise<{ n: number }[]>) => (await consulta)[0]!.n;
  const asignacionesDe = (reservaId: string) =>
    sql`select * from bank_allocations where booking_id = ${reservaId} order by created_at`;
  const eventos = (reservaId: string, tipo: string) =>
    n(
      sql`select count(*)::int as n from booking_events
        where booking_id = ${reservaId} and type = ${tipo}`,
    );
  const comprometido = async (cuentaId: string) =>
    (await cuentas.list()).find((c) => c.id === cuentaId)!.committedCents;
  const escrituras = async () => {
    const [f] = await sql`select
      (select count(*) from bank_allocations)::int as a, (select count(*) from booking_events)::int as e,
      (select count(*) from audit_events)::int as u, (select count(*) from admin_cases)::int as c,
      (select count(*) from bookings where status = 'expirada')::int as x`;
    return JSON.stringify(f);
  };

  describe("asignar", () => {
    test("elige la primera por prioridad, por el importe completo, con snapshot, evento y auditoría", async () => {
      await cuenta({ name: "Segunda", priority: 2, clabe: "999999999999999999" });
      const primera = await cuenta({ name: "Primera", priority: 1 });
      const r = await sembrarReservaConToken(sql, { monto: 150000 });

      const res = await asignaciones.requestInstructions(r.token);

      expect(res.pendingCents).toBe(150000);
      expect(res.instructions).toMatchObject({
        bankName: "Banco Ficticio",
        accountHolder: TITULAR,
        clabe: CLABE,
        amountCents: 150000,
      });
      const [a] = await asignacionesDe(r.id);
      expect(a).toMatchObject({
        bank_account_id: primera,
        amount_cents: 150000,
        status: "vigente",
      });
      expect(a.calendar_month).toBe(res.instructions.calendarMonth);
      expect(await eventos(r.id, "cuenta_asignada")).toBe(1);
      expect(await comprometido(primera)).toBe(150000);

      const [audit] = await sql`select actor_type, actor_user_id, after from audit_events
        where action = 'bank_allocation.created'`;
      expect(audit.actor_type).toBe("comprador");
      expect(audit.actor_user_id).toBeNull();
      // La auditoría no guarda ni la CLABE completa, ni el titular, ni el token.
      expect(JSON.stringify(audit.after)).not.toContain(CLABE);
      expect(JSON.stringify(audit.after)).not.toContain(TITULAR);
      expect(JSON.stringify(audit.after)).not.toContain(r.token);
      expect(audit.after.clabeUltimos4).toBe(CLABE.slice(-4));
    });

    test("salta la cuenta sin capacidad para el importe completo y no divide", async () => {
      await cuenta({ priority: 1, limite: 100000 });
      const segunda = await cuenta({ priority: 2, limite: 200000 });
      const r = await sembrarReservaConToken(sql, { monto: 150000 });
      await asignaciones.requestInstructions(r.token);
      expect(
        (await asignacionesDe(r.id)).map((a: { bank_account_id: string }) => a.bank_account_id),
      ).toEqual([segunda]);
    });

    test("es idempotente: repetir devuelve la misma asignación sin evento, auditoría ni consumo extra", async () => {
      const c = await cuenta();
      const r = await sembrarReservaConToken(sql, { monto: 80000 });
      const uno = await asignaciones.requestInstructions(r.token);
      const dos = await asignaciones.requestInstructions(r.token);
      expect(dos).toEqual(uno);
      expect(await asignacionesDe(r.id)).toHaveLength(1);
      expect(await eventos(r.id, "cuenta_asignada")).toBe(1);
      expect(await n(sql`select count(*)::int as n from audit_events`)).toBe(1);
      expect(await comprometido(c)).toBe(80000);
    });

    test("el snapshot no cambia al editar la cuenta, su prioridad o su elegibilidad", async () => {
      const c = await cuenta({ priority: 1 });
      const r = await sembrarReservaConToken(sql, { monto: 80000 });
      const original = await asignaciones.requestInstructions(r.token);

      await sql`update bank_accounts set clabe = '000000000000000001', bank_name = 'Otro',
        account_holder = 'Otro titular', priority = 9, is_eligible = false where id = ${c}`;

      expect(await asignaciones.requestInstructions(r.token)).toEqual(original);
      expect((await asignaciones.find(r.token))?.instructions).toEqual(original.instructions);
    });

    test("sin cuenta elegible: error 409, ninguna asignación y una sola alerta", async () => {
      await cuenta({ elegible: false });
      await cuenta({ limite: 1000 });
      const r = await sembrarReservaConToken(sql, { monto: 150000 });

      for (let i = 0; i < 2; i++) {
        const error = await asignaciones.requestInstructions(r.token).catch((e) => e);
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.code).toBe("no_eligible_account");
      }
      expect(await asignacionesDe(r.id)).toHaveLength(0);
      expect(await eventos(r.id, "cuenta_asignada")).toBe(0);
      const casos = await sql`select type, status from admin_cases where booking_id = ${r.id}`;
      expect(casos).toHaveLength(1);
      expect(casos[0]).toMatchObject({ type: "sin_cuenta_elegible", status: "abierto" });
      const [audit] = await sql`select actor_type, actor_user_id from audit_events
        where action = 'admin_case.opened'`;
      expect(audit).toMatchObject({ actor_type: "sistema", actor_user_id: null });
    });

    test("la alerta distingue el problema vigente del que solo espera cierre administrativo", async () => {
      const r = await sembrarReservaConToken(sql, { monto: 150000 });
      await asignaciones.requestInstructions(r.token).catch(() => {});
      expect((await asignaciones.alertas()).map((a) => a.vigente)).toEqual([true]);

      await cuenta();
      await asignaciones.requestInstructions(r.token);
      const alertas = await asignaciones.alertas();
      expect(alertas).toHaveLength(1); // el caso no se resuelve ni se oculta solo
      expect(alertas[0]!.vigente).toBe(false);
      expect((await sql`select status from admin_cases`)[0]!.status).toBe("abierto");
    });

    test("el mes se fija con AGENCY_TIMEZONE, también en el límite de medianoche", async () => {
      const c = await cuenta({ limite: 100000 });
      const lejos = new Date("2099-01-01T00:00:00Z");
      const a = await sembrarReservaConToken(sql, { monto: 100000, expiraEn: lejos });
      const b = await sembrarReservaConToken(sql, { monto: 100000, expiraEn: lejos });
      // 23:59 del 30 de noviembre en Ciudad de México (UTC-6) y un minuto después, ya diciembre.
      ahora = new Date("2026-12-01T05:59:00Z");
      expect((await asignaciones.requestInstructions(a.token)).instructions.calendarMonth).toBe(
        "2026-11",
      );
      ahora = new Date("2026-12-01T06:00:00Z");
      // El límite de noviembre ya está agotado, pero el de diciembre está libre.
      expect((await asignaciones.requestInstructions(b.token)).instructions.calendarMonth).toBe(
        "2026-12",
      );
      const meses = await sql`select calendar_month from bank_allocations
        where bank_account_id = ${c} order by calendar_month`;
      expect(meses.map((m: { calendar_month: string }) => m.calendar_month)).toEqual([
        "2026-11",
        "2026-12",
      ]);
    });
  });

  describe("estado de la reserva", () => {
    test("pendiente y parcial piden; la parcial en efectivo asigna el importe completo, no el saldo", async () => {
      await cuenta();
      const r = await sembrarReservaConToken(sql, { monto: 100000, estado: "parcial" });
      await sql`insert into cash_payments (booking_id, amount_cents, recorded_by)
        values (${r.id}, 30000, ${admin})`;
      const res = await asignaciones.requestInstructions(r.token);
      expect(res.instructions.amountCents).toBe(100000); // comprometido
      expect(res.pendingCents).toBe(70000); // saldo por pagar
      expect((await asignacionesDe(r.id))[0]!.amount_cents).toBe(100000);
    });

    test("en_revision recupera su snapshot, pero no puede pedir uno nuevo", async () => {
      const c = await cuenta();
      const con = await sembrarReservaConToken(sql, { monto: 50000, estado: "en_revision" });
      const sin = await sembrarReservaConToken(sql, { monto: 50000, estado: "en_revision" });
      await sembrarAsignacionDe(sql, con.id, c, 50000);

      expect((await asignaciones.requestInstructions(con.token)).instructions.clabe).toBe(CLABE);
      await expect(asignaciones.requestInstructions(sin.token)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await asignacionesDe(sin.id)).toHaveLength(0);
    });

    test("pagada, cancelada y expirada no reciben instrucciones, aunque conserven asignación", async () => {
      const c = await cuenta();
      for (const estado of ["pagada", "cancelada", "expirada"]) {
        const r = await sembrarReservaConToken(sql, { monto: 50000, estado });
        await sembrarAsignacionDe(sql, r.id, c, 50000);
        await expect(asignaciones.requestInstructions(r.token)).rejects.toBeInstanceOf(
          ConflictError,
        );
        expect(await asignaciones.find(r.token)).toBeNull();
      }
    });

    test("una pendiente vencida se materializa como expirada y no recibe instrucciones", async () => {
      await cuenta();
      const r = await sembrarReservaConToken(sql, {
        monto: 50000,
        expiraEn: new Date(Date.now() - 60_000),
      });
      await expect(asignaciones.requestInstructions(r.token)).rejects.toBeInstanceOf(ConflictError);
      expect((await sql`select status from bookings where id = ${r.id}`)[0]!.status).toBe(
        "expirada",
      );
      expect(await asignacionesDe(r.id)).toHaveLength(0);
    });
  });

  describe("token", () => {
    test("un token inválido, mal formado o inexistente da el mismo 404", async () => {
      for (const token of ["", "corto", "x".repeat(43), generarToken()]) {
        await expect(asignaciones.requestInstructions(token)).rejects.toBeInstanceOf(NotFoundError);
      }
    });

    test("regenerar el enlace invalida el anterior y el nuevo funciona", async () => {
      await cuenta();
      const r = await sembrarReservaConToken(sql, { monto: 50000 });
      const { token } = await reservas.regenerateToken(r.id, { actorUserId: admin, reason: "x" });
      await expect(asignaciones.requestInstructions(r.token)).rejects.toBeInstanceOf(NotFoundError);
      expect((await asignaciones.requestInstructions(token)).pendingCents).toBe(50000);
    });
  });

  describe("liberación", () => {
    test("una pendiente vencida sin materializar sigue consumiendo hasta que se libera; luego deja de consumir", async () => {
      const c = await cuenta();
      const r = await sembrarReservaConToken(sql, {
        monto: 70000,
        expiraEn: new Date(Date.now() - 60_000),
      });
      await sembrarAsignacionDe(sql, r.id, c, 70000);
      expect(await comprometido(c)).toBe(70000); // vencida pero no materializada: conservador

      // Cualquier operación que bloquea su salida materializa la expiración y libera.
      const otra = await sembrarReservaConToken(sql, { monto: 1000, departureId: r.departureId });
      await asignaciones.requestInstructions(otra.token);

      expect((await asignacionesDe(r.id))[0]).toMatchObject({ status: "liberada" });
      expect((await asignacionesDe(r.id))[0]!.released_at).not.toBeNull();
      expect(await comprometido(c)).toBe(1000); // solo la nueva
      expect(await eventos(r.id, "cuenta_liberada")).toBe(1);
      const [e] = await sql`select actor_type, actor_user_id from booking_events
        where booking_id = ${r.id} and type = 'cuenta_liberada'`;
      expect(e).toMatchObject({ actor_type: "sistema", actor_user_id: null });
      const [audit] = await sql`select actor_type, after from audit_events
        where action = 'bank_allocation.released'`;
      expect(audit.actor_type).toBe("sistema");
      expect(audit.after).toMatchObject({ status: "liberada", amountCents: 70000 });
    });

    test("cancelar libera, es idempotente y audita al admin; reactivar no recrea la asignación", async () => {
      const c = await cuenta();
      const r = await sembrarReservaConToken(sql, { monto: 60000 });
      await asignaciones.requestInstructions(r.token);
      expect(await comprometido(c)).toBe(60000);

      await reservas.cancel(r.id, { actorUserId: admin, reason: "cliente desistió" });
      await reservas.cancel(r.id, { actorUserId: admin, reason: "otra vez" });

      expect((await asignacionesDe(r.id))[0]).toMatchObject({
        status: "liberada",
        amount_cents: 60000, // importe, mes y snapshot históricos intactos
      });
      expect(await comprometido(c)).toBe(0);
      expect(await eventos(r.id, "cuenta_liberada")).toBe(1);
      const [e] = await sql`select actor_type, actor_user_id, reason from booking_events
        where booking_id = ${r.id} and type = 'cuenta_liberada'`;
      expect(e).toMatchObject({
        actor_type: "admin",
        actor_user_id: admin,
        reason: "cliente desistió",
      });
      expect(
        await n(
          sql`select count(*)::int as n from audit_events where action = 'bank_allocation.released'`,
        ),
      ).toBe(1);

      await reservas.reactivate(r.id, { actorUserId: admin, reason: "volvió" });
      expect(await comprometido(c)).toBe(0);
      expect(await asignacionesDe(r.id)).toHaveLength(1); // no se recreó
      // El comprador pide de nuevo: nueva asignación vigente, la liberada queda como historial.
      await asignaciones.requestInstructions(r.token);
      const todas = await asignacionesDe(r.id);
      expect(todas.map((a: { status: string }) => a.status)).toEqual(["liberada", "vigente"]);
    });

    test("no libera con un comprobante pendiente ni con un SPEI verificado", async () => {
      const c = await cuenta();
      for (const estado of ["pendiente", "verificado"] as const) {
        const r = await sembrarReservaConToken(sql, { monto: 40000 });
        const a = await sembrarAsignacionDe(sql, r.id, c, 40000);
        await sembrarReporte(sql, r.id, a, estado);
        await reservas.cancel(r.id, { actorUserId: admin, reason: "x" });
        expect((await asignacionesDe(r.id))[0]!.status).toBe("vigente");
        expect(await eventos(r.id, "cuenta_liberada")).toBe(0);
      }
    });

    test("un comprobante rechazado no impide liberar", async () => {
      const c = await cuenta();
      const r = await sembrarReservaConToken(sql, { monto: 40000 });
      const a = await sembrarAsignacionDe(sql, r.id, c, 40000);
      await sembrarReporte(sql, r.id, a, "rechazado");
      await reservas.cancel(r.id, { actorUserId: admin, reason: "x" });
      expect((await asignacionesDe(r.id))[0]!.status).toBe("liberada");
    });
  });

  describe("atomicidad y lecturas", () => {
    test("un fallo inesperado al auditar revierte la asignación y el evento", async () => {
      await cuenta();
      const r = await sembrarReservaConToken(sql, { monto: 50000 });
      await sql`create or replace function falla_auditoria() returns trigger as $$
        begin raise exception 'fallo de auditoria simulado'; end; $$ language plpgsql`;
      await sql`create trigger falla_auditoria before insert on audit_events
        for each row execute function falla_auditoria()`;
      try {
        await expect(asignaciones.requestInstructions(r.token)).rejects.toThrow();
      } finally {
        await sql`drop trigger falla_auditoria on audit_events`;
        await sql`drop function falla_auditoria()`;
      }
      expect(await asignacionesDe(r.id)).toHaveLength(0);
      expect(await eventos(r.id, "cuenta_asignada")).toBe(0);
      // Sin el fallo, la misma solicitud funciona.
      await asignaciones.requestInstructions(r.token);
      expect(await asignacionesDe(r.id)).toHaveLength(1);
    });

    test("las lecturas (find y alertas) no escriben nada, ni siquiera con una reserva vencida", async () => {
      const c = await cuenta();
      const vigente = await sembrarReservaConToken(sql, { monto: 50000 });
      await asignaciones.requestInstructions(vigente.token);
      const vencida = await sembrarReservaConToken(sql, {
        monto: 50000,
        expiraEn: new Date(Date.now() - 60_000),
      });
      await sembrarAsignacionDe(sql, vencida.id, c, 50000);
      const sinAsignar = await sembrarReservaConToken(sql, { monto: 50000 });

      const antes = await escrituras();
      expect(await asignaciones.find(vigente.token)).not.toBeNull();
      expect(await asignaciones.find(vencida.token)).toBeNull();
      expect(await asignaciones.find(sinAsignar.token)).toBeNull();
      expect(await asignaciones.find("token-invalido")).toBeNull();
      await asignaciones.alertas();
      expect(await escrituras()).toBe(antes);
    });
  });
});
