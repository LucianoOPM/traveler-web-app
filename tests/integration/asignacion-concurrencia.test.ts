import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import * as esquema from "@db/schema";
import { AppError, ConflictError, NotFoundError } from "@lib/errors";
import { BookingService } from "@modules/bookings/application/booking-service";
import { DrizzleBookingRepository } from "@modules/bookings/infrastructure/drizzle-booking-repository";
import { BankAccountService } from "@modules/payments/application/bank-account-service";
import { BankAllocationService } from "@modules/payments/application/bank-allocation-service";
import { DrizzleBankAccountRepository } from "@modules/payments/infrastructure/drizzle-bank-account-repository";
import { DrizzleBankAllocationRepository } from "@modules/payments/infrastructure/drizzle-bank-allocation-repository";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";
import {
  sembrarAsignacionDe,
  sembrarCuenta,
  sembrarReservaConToken,
  TITULAR,
  CLABE,
  ZONA,
} from "../support/cuentas";

// Concurrencia REAL del servicio de asignación: una conexión independiente por contendiente (como
// en H3) y PostgreSQL real. Protocolo (ADR-029): la salida y luego las cuentas por `id`.
const base = abrirBaseDePruebas();
const ESPERA_MAX_MS = 10_000;
const RONDAS = 8;

describe.skipIf(!base && !process.env.CI)("asignación bancaria: concurrencia", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  const abiertos: SQL[] = [];
  let admin = "";

  /** Servicios sobre una conexión propia (no el pool compartido). */
  const propio = () => {
    const cliente = new SQL({ url: process.env.TEST_DATABASE_URL!, max: 2 });
    abiertos.push(cliente);
    const conexion = drizzle({ client: cliente, schema: esquema });
    return {
      asignaciones: new BankAllocationService(new DrizzleBankAllocationRepository(conexion), ZONA),
      reservas: new BookingService(new DrizzleBookingRepository(conexion), { holdHours: 24 }),
      cuentas: new BankAccountService(new DrizzleBankAccountRepository(conexion), ZONA),
    };
  };
  const cerrarDesde = (desde: number) =>
    Promise.allSettled(abiertos.splice(desde).map((s) => s.close()));

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-asignacion-concurrencia@example.test', now(), now()) returning id`;
    admin = u.id;
  });
  beforeEach(async () => {
    await sql`delete from audit_events`;
    await sql`delete from payment_reports`;
    await sql`delete from admin_cases`;
    await sql`delete from bank_allocations`;
    await sql`delete from bank_accounts`;
  });
  afterAll(async () => {
    await Promise.allSettled(abiertos.map((s) => s.close()));
    await sql.close();
  });

  const n = async (consulta: Promise<{ n: number }[]>) => (await consulta)[0]!.n;
  const vigentes = (reservaId: string) =>
    n(
      sql`select count(*)::int as n from bank_allocations
        where booking_id = ${reservaId} and status = 'vigente'`,
    );
  const comprometidoDe = (cuentaId: string) =>
    n(
      sql`select coalesce(sum(amount_cents), 0)::int as n from bank_allocations
        where bank_account_id = ${cuentaId} and status = 'vigente'`,
    );
  /** Un fallo que no sea de negocio (interbloqueo, error de SQL…) rompe la prueba. */
  const soloNegocio = (r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected" && !(r.reason instanceof AppError)) throw r.reason;
  };

  const esperarBloqueados = async (cantidad: number) => {
    const fin = Date.now() + ESPERA_MAX_MS;
    while (Date.now() < fin) {
      const [f] = await sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and state = 'active' and wait_event_type = 'Lock'`;
      if (f.n >= cantidad) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Se esperaban ${cantidad} sesiones bloqueadas y no llegaron`);
  };

  /**
   * Compuerta: una conexión propia retiene el bloqueo de la cuenta mientras se lanza la operación;
   * se confirma con `pg_stat_activity` que esta espera y solo entonces se aplica `cambio` y se libera.
   */
  async function conCuentaBloqueada<T>(
    cuentaId: string,
    operacion: () => Promise<T>,
    cambio: (tx: SQL) => Promise<unknown>,
  ) {
    const cliente = new SQL({ url: process.env.TEST_DATABASE_URL!, max: 1 });
    abiertos.push(cliente);
    let soltar!: () => void;
    const puerta = new Promise<void>((r) => (soltar = r));
    let tomada!: () => void;
    const lista = new Promise<void>((r) => (tomada = r));
    const retenedor = cliente.begin(async (tx) => {
      await tx`select id from bank_accounts where id = ${cuentaId} for update`;
      tomada();
      await puerta;
      await cambio(tx as unknown as SQL);
    });
    await lista;
    const en_curso = operacion().then(
      (v) => ({ status: "fulfilled", value: v }) as PromiseFulfilledResult<T>,
      (e) => ({ status: "rejected", reason: e }) as PromiseRejectedResult,
    );
    await esperarBloqueados(1);
    soltar();
    await retenedor;
    return en_curso;
  }

  test("reservas que compiten por una cuenta (misma salida y salidas distintas): nunca se excede el límite", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      await sql`delete from admin_cases`;
      await sql`delete from bank_allocations`;
      await sql`delete from bank_accounts`;
      const cuenta = await sembrarCuenta(sql, { limite: 250_000 }); // caben 2 de 100,000
      const compartida = await sembrarReservaConToken(sql, { monto: 100_000 });
      const reservas = [
        compartida,
        await sembrarReservaConToken(sql, { monto: 100_000, departureId: compartida.departureId }),
        await sembrarReservaConToken(sql, { monto: 100_000, departureId: compartida.departureId }),
        await sembrarReservaConToken(sql, { monto: 100_000 }),
        await sembrarReservaConToken(sql, { monto: 100_000 }),
        await sembrarReservaConToken(sql, { monto: 100_000 }),
      ];
      const desde = abiertos.length;
      const resultados = await Promise.allSettled(
        reservas.map((r) => propio().asignaciones.requestInstructions(r.token)),
      );
      await cerrarDesde(desde);

      resultados.forEach(soloNegocio);
      const exitos = resultados.filter((r) => r.status === "fulfilled");
      expect(exitos).toHaveLength(2);
      for (const r of resultados) {
        if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
      }
      expect(await comprometidoDe(cuenta)).toBe(200_000);
      // Una alerta por cada reserva rechazada; ninguna duplicada.
      expect(await n(sql`select count(*)::int as n from admin_cases`)).toBe(4);
    }
  });

  test("solicitudes simultáneas de una misma reserva crean una sola asignación y devuelven la misma", async () => {
    const cuenta = await sembrarCuenta(sql);
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const r = await sembrarReservaConToken(sql, { monto: 50_000 });
      const desde = abiertos.length;
      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, () => propio().asignaciones.requestInstructions(r.token)),
      );
      await cerrarDesde(desde);
      const ok = resultados.map((x) => (x.status === "fulfilled" ? x.value : x.reason));
      for (const v of ok) expect(v).toEqual(ok[0]);
      expect(await vigentes(r.id)).toBe(1);
      expect(
        await n(
          sql`select count(*)::int as n from booking_events
            where booking_id = ${r.id} and type = 'cuenta_asignada'`,
        ),
      ).toBe(1);
    }
    expect(await comprometidoDe(cuenta)).toBe(RONDAS * 50_000);
  });

  test("deshabilitar la cuenta mientras una asignación espera: la asignación ya no la usa", async () => {
    const cuenta = await sembrarCuenta(sql);
    const r = await sembrarReservaConToken(sql, { monto: 50_000 });
    const { asignaciones } = propio();
    const resultado = await conCuentaBloqueada(
      cuenta,
      () => asignaciones.requestInstructions(r.token),
      (tx) => tx`update bank_accounts set is_eligible = false where id = ${cuenta}`,
    );
    expect(resultado.status).toBe("rejected");
    expect((resultado as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await vigentes(r.id)).toBe(0);
  });

  test("bajar el límite mientras una asignación espera: la asignación respeta el límite nuevo", async () => {
    const cuenta = await sembrarCuenta(sql, { limite: 100_000 });
    const r = await sembrarReservaConToken(sql, { monto: 80_000 });
    const { asignaciones } = propio();
    const resultado = await conCuentaBloqueada(
      cuenta,
      () => asignaciones.requestInstructions(r.token),
      (tx) => tx`update bank_accounts set monthly_limit_cents = 50000 where id = ${cuenta}`,
    );
    expect(resultado.status).toBe("rejected");
    expect(await vigentes(r.id)).toBe(0);
    expect(await comprometidoDe(cuenta)).toBe(0);
  });

  test("editar el límite contra una asignación real: el límite nunca queda por debajo de lo comprometido", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      await sql`delete from bank_allocations`;
      await sql`delete from bank_accounts`;
      const cuenta = await sembrarCuenta(sql, { limite: 100_000 });
      const r = await sembrarReservaConToken(sql, { monto: 80_000 });
      const desde = abiertos.length;
      const a = propio();
      const b = propio();
      const [asignar, editar] = await Promise.allSettled([
        a.asignaciones.requestInstructions(r.token),
        b.cuentas.edit(admin, cuenta, {
          name: "Cuenta",
          bankName: "Banco Ficticio",
          accountHolder: TITULAR,
          clabe: CLABE,
          priority: 1,
          monthlyLimitCents: 50_000,
        }),
      ]);
      await cerrarDesde(desde);
      soloNegocio(asignar!);
      soloNegocio(editar!);
      const [{ limite }] = await sql`select monthly_limit_cents as limite from bank_accounts
        where id = ${cuenta}`;
      const comprometido = await comprometidoDe(cuenta);
      expect(comprometido).toBeLessThanOrEqual(limite);
      // Exactamente una de las dos ganó el orden: o hay asignación y la edición dio 409, o al revés.
      if (asignar!.status === "fulfilled") {
        expect(editar!.status).toBe("rejected");
        expect(limite).toBe(100_000);
        expect(comprometido).toBe(80_000);
      } else {
        expect(editar!.status).toBe("fulfilled");
        expect(limite).toBe(50_000);
        expect(comprometido).toBe(0);
      }
    }
  });

  test("deshabilitar contra una asignación real: o se asignó antes, o no se asigna; nunca queda a medias", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      await sql`delete from bank_allocations`;
      await sql`delete from bank_accounts`;
      const cuenta = await sembrarCuenta(sql);
      const r = await sembrarReservaConToken(sql, { monto: 50_000 });
      const desde = abiertos.length;
      const [asignar, deshabilitar] = await Promise.allSettled([
        propio().asignaciones.requestInstructions(r.token),
        propio().cuentas.setEligible(admin, cuenta, false),
      ]);
      await cerrarDesde(desde);
      soloNegocio(asignar!);
      expect(deshabilitar!.status).toBe("fulfilled");
      expect(await vigentes(r.id)).toBe(asignar!.status === "fulfilled" ? 1 : 0);
      const [{ elegible }] = await sql`select is_eligible as elegible from bank_accounts
        where id = ${cuenta}`;
      expect(elegible).toBe(false);
    }
  });

  test("liberar (cancelar) concurrentemente con una nueva asignación: sin interbloqueo ni exceso", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      await sql`delete from bank_allocations`;
      await sql`delete from bank_accounts`;
      const cuenta = await sembrarCuenta(sql, { limite: 100_000 });
      const a = await sembrarReservaConToken(sql, { monto: 100_000 });
      await sembrarAsignacionDe(sql, a.id, cuenta, 100_000);
      const b = await sembrarReservaConToken(sql, { monto: 100_000 });
      const desde = abiertos.length;
      const [cancelar, pedir] = await Promise.allSettled([
        propio().reservas.cancel(a.id, { actorUserId: admin, reason: "x" }),
        propio().asignaciones.requestInstructions(b.token),
      ]);
      await cerrarDesde(desde);
      soloNegocio(cancelar!);
      soloNegocio(pedir!);
      expect(cancelar!.status).toBe("fulfilled");
      expect(await vigentes(a.id)).toBe(0);
      expect(await comprometidoDe(cuenta)).toBeLessThanOrEqual(100_000);
      // Si B llegó antes de la liberación no cabía (409); si llegó después, se le asignó.
      expect(await vigentes(b.id)).toBe(pedir!.status === "fulfilled" ? 1 : 0);
    }
  });

  test("regenerar el enlace contra una solicitud con el enlace anterior: el anterior queda invalidado", async () => {
    await sembrarCuenta(sql);
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const r = await sembrarReservaConToken(sql, { monto: 50_000 });
      const desde = abiertos.length;
      const [pedir, regenerar] = await Promise.allSettled([
        propio().asignaciones.requestInstructions(r.token),
        propio().reservas.regenerateToken(r.id, { actorUserId: admin, reason: "x" }),
      ]);
      await cerrarDesde(desde);
      soloNegocio(pedir!);
      expect(regenerar!.status).toBe("fulfilled");
      if (pedir!.status === "rejected") expect(pedir!.reason).toBeInstanceOf(NotFoundError);
      expect(await vigentes(r.id)).toBe(pedir!.status === "fulfilled" ? 1 : 0);
      // Pase lo que pase, el enlace anterior ya no funciona y el nuevo sí.
      const { asignaciones } = propio();
      await expect(asignaciones.requestInstructions(r.token)).rejects.toBeInstanceOf(NotFoundError);
      const nuevo = (regenerar as PromiseFulfilledResult<{ token: string }>).value.token;
      await asignaciones.requestInstructions(nuevo);
      expect(await vigentes(r.id)).toBe(1);
      await cerrarDesde(desde);
    }
  });

  test("expiraciones, asignaciones y cancelaciones cruzadas entre salidas y cuentas: sin interbloqueos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      await sql`delete from bank_allocations`;
      await sql`delete from bank_accounts`;
      const cuentas = [
        await sembrarCuenta(sql, { priority: 1, limite: 300_000 }),
        await sembrarCuenta(sql, { priority: 2, limite: 300_000 }),
        await sembrarCuenta(sql, { priority: 3, limite: 300_000 }),
      ];
      const vencida = new Date(Date.now() - 60_000);
      const tareas: Array<() => Promise<unknown>> = [];
      // Cuatro salidas; cada una con una reserva vencida cuya asignación está en una cuenta distinta
      // (el orden de los `id` no coincide con el de las salidas), una viva que se cancelará y una
      // nueva que pide instrucciones.
      for (let i = 0; i < 4; i++) {
        const vieja = await sembrarReservaConToken(sql, { monto: 10_000, expiraEn: vencida });
        await sembrarAsignacionDe(sql, vieja.id, cuentas[i % 3]!, 10_000);
        const viva = await sembrarReservaConToken(sql, {
          monto: 10_000,
          departureId: vieja.departureId,
        });
        await sembrarAsignacionDe(sql, viva.id, cuentas[(i + 1) % 3]!, 10_000);
        const nueva = await sembrarReservaConToken(sql, {
          monto: 10_000,
          departureId: vieja.departureId,
        });
        tareas.push(
          () => propio().asignaciones.requestInstructions(nueva.token),
          () => propio().reservas.cancel(viva.id, { actorUserId: admin, reason: "x" }),
        );
      }
      const desde = abiertos.length;
      const resultados = await Promise.allSettled(tareas.map((t) => t()));
      await cerrarDesde(desde);
      resultados.forEach(soloNegocio);
      expect(resultados.every((r) => r.status === "fulfilled")).toBe(true);
      // Todo lo vencido y lo cancelado quedó liberado; solo consumen las nuevas.
      expect(
        await n(
          sql`select count(*)::int as n from bank_allocations a join bookings b on b.id = a.booking_id
            where a.status = 'vigente' and b.status in ('expirada', 'cancelada')`,
        ),
      ).toBe(0);
    }
  });
});
