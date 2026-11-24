import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import * as esquema from "@db/schema";
import { AppError, ConflictError, NotFoundError } from "@lib/errors";
import { BookingService } from "@modules/bookings/application/booking-service";
import { DrizzleBookingRepository } from "@modules/bookings/infrastructure/drizzle-booking-repository";
import { MediaService } from "@modules/media/application/media-service";
import { AlmacenEnDisco } from "@modules/media/infrastructure/almacen-en-disco";
import { DrizzleMediaRepository } from "@modules/media/infrastructure/drizzle-media-repository";
import { BankAllocationService } from "@modules/payments/application/bank-allocation-service";
import { PaymentReportService } from "@modules/payments/application/payment-report-service";
import { DrizzleBankAllocationRepository } from "@modules/payments/infrastructure/drizzle-bank-allocation-repository";
import { DrizzlePaymentReportRepository } from "@modules/payments/infrastructure/drizzle-payment-report-repository";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";
import {
  sembrarAsignacionDe,
  sembrarCuenta,
  sembrarReservaConToken,
  ZONA,
} from "../support/cuentas";
import { jpeg } from "../support/imagenes";

// Concurrencia REAL del reporte SPEI: una conexión independiente por contendiente (como en H3 y
// #84) y PostgreSQL real. Protocolo (ADR-029): la salida y luego las cuentas por `id`.
const base = abrirBaseDePruebas();
const RONDAS = 8;

describe.skipIf(!base && !process.env.CI)("reporte SPEI: concurrencia", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  const abiertos: SQL[] = [];
  let carpeta = "";
  let admin = "";

  /** Servicios sobre una conexión propia y el mismo directorio de evidencias. */
  const propio = () => {
    const cliente = new SQL({ url: process.env.TEST_DATABASE_URL!, max: 2 });
    abiertos.push(cliente);
    const conexion = drizzle({ client: cliente, schema: esquema });
    const media = new MediaService(
      new DrizzleMediaRepository(conexion),
      new AlmacenEnDisco(carpeta),
    );
    return {
      reportes: new PaymentReportService(new DrizzlePaymentReportRepository(conexion), media),
      asignaciones: new BankAllocationService(new DrizzleBankAllocationRepository(conexion), ZONA),
      reservas: new BookingService(new DrizzleBookingRepository(conexion), { holdHours: 24 }),
    };
  };
  const cerrarDesde = (desde: number) =>
    Promise.allSettled(abiertos.splice(desde).map((s) => s.close()));

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    carpeta = await mkdtemp(path.join(tmpdir(), "traveltech-reportes-conc-"));
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-reportes-conc@example.test', now(), now()) returning id`;
    admin = u.id;
  });
  beforeEach(async () => {
    await sql`delete from audit_events`;
    await sql`delete from payment_reports`;
    await sql`delete from admin_cases`;
    await sql`delete from bank_allocations`;
    await sql`delete from bank_accounts`;
    await sql`delete from media_assets`;
    await rm(path.join(carpeta, "media"), { recursive: true, force: true });
  });
  afterAll(async () => {
    await Promise.allSettled(abiertos.map((s) => s.close()));
    await rm(carpeta, { recursive: true, force: true });
    await sql.close();
  });

  const archivos = async () => {
    try {
      return await readdir(path.join(carpeta, "media"));
    } catch {
      return [];
    }
  };
  const n = async (consulta: Promise<{ n: number }[]>) => (await consulta)[0]!.n;
  const reportesDe = (reservaId: string) =>
    n(sql`select count(*)::int as n from payment_reports where booking_id = ${reservaId}`);
  const vigentes = (reservaId: string) =>
    n(
      sql`select count(*)::int as n from bank_allocations
        where booking_id = ${reservaId} and status = 'vigente'`,
    );
  const estado = async (reservaId: string) =>
    (await sql`select status from bookings where id = ${reservaId}`)[0]!.status as string;
  /** Un fallo que no sea de negocio (interbloqueo, error de SQL…) rompe la prueba. */
  const soloNegocio = (r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected" && !(r.reason instanceof AppError)) throw r.reason;
  };
  const escenario = async (monto = 100_000, estadoReserva = "pendiente", cuentaId?: string) => {
    const cuenta = cuentaId ?? (await sembrarCuenta(sql));
    const r = await sembrarReservaConToken(sql, { monto, estado: estadoReserva });
    await sembrarAsignacionDe(sql, r.id, cuenta, monto);
    return { ...r, cuenta };
  };
  const envio = (amountCents: number, requestKey = crypto.randomUUID()) => ({
    requestKey,
    amountCents,
  });

  test("el mismo envío repetido a la vez crea un solo reporte, archivo, evento y activo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const r = await escenario(100_000);
      const mismo = envio(20_000);
      const desde = abiertos.length;
      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, () => propio().reportes.report(r.token, mismo, jpeg())),
      );
      await cerrarDesde(desde);
      resultados.forEach(soloNegocio);
      const ok = resultados.filter((x) => x.status === "fulfilled");
      expect(ok).toHaveLength(6);
      const valores = ok.map((x) => JSON.stringify(x.value));
      expect(new Set(valores).size).toBe(1);
      expect(await reportesDe(r.id)).toBe(1);
      expect(
        await n(
          sql`select count(*)::int as n from booking_events
            where booking_id = ${r.id} and type = 'pago_reportado'`,
        ),
      ).toBe(1);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(1);
      expect(await archivos()).toHaveLength(1);
      await sql`delete from payment_reports`;
      await sql`delete from media_assets`;
      await rm(path.join(carpeta, "media"), { recursive: true, force: true });
    }
  });

  test("reportes legítimos simultáneos (claves distintas, mismo importe) se crean todos", async () => {
    const r = await escenario(100_000);
    const desde = abiertos.length;
    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => propio().reportes.report(r.token, envio(20_000), jpeg())),
    );
    await cerrarDesde(desde);
    expect(resultados.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await reportesDe(r.id)).toBe(5);
    expect(await archivos()).toHaveLength(5);
    expect(await estado(r.id)).toBe("en_revision");
  });

  test("reportar contra cancelar: si gana el reporte la asignación se conserva; si gana la cancelación, el reporte da 409", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      await sql`delete from payment_reports`;
      await sql`delete from bank_allocations`;
      await sql`delete from bank_accounts`;
      await sql`delete from media_assets`;
      await rm(path.join(carpeta, "media"), { recursive: true, force: true });
      const r = await escenario(100_000);
      const desde = abiertos.length;
      const [reportar, cancelar] = await Promise.allSettled([
        propio().reportes.report(r.token, envio(10_000), jpeg()),
        propio().reservas.cancel(r.id, { actorUserId: admin, reason: "x" }),
      ]);
      await cerrarDesde(desde);
      soloNegocio(reportar!);
      expect(cancelar!.status).toBe("fulfilled");
      if (reportar!.status === "fulfilled") {
        // El reporte llegó antes: queda pendiente, la reserva cancelada conserva la asignación.
        expect(await reportesDe(r.id)).toBe(1);
        expect(await vigentes(r.id)).toBe(1);
        expect(await archivos()).toHaveLength(1);
      } else {
        expect(reportar!.reason).toBeInstanceOf(ConflictError);
        expect(await reportesDe(r.id)).toBe(0);
        expect(await vigentes(r.id)).toBe(0); // la cancelación liberó
        expect(await archivos()).toHaveLength(0);
      }
      expect(await estado(r.id)).toBe("cancelada");
    }
  });

  test("reportar contra la expiración de una reserva vencida: sin interbloqueo, expira y no deja archivos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const cuenta = await sembrarCuenta(sql);
      const r = await sembrarReservaConToken(sql, {
        monto: 50_000,
        expiraEn: new Date(Date.now() - 60_000),
      });
      await sembrarAsignacionDe(sql, r.id, cuenta, 50_000);
      const otra = await sembrarReservaConToken(sql, { monto: 1000, departureId: r.departureId });
      const desde = abiertos.length;
      const resultados = await Promise.allSettled([
        propio().reportes.report(r.token, envio(1000), jpeg()),
        propio().asignaciones.requestInstructions(otra.token),
      ]);
      await cerrarDesde(desde);
      resultados.forEach(soloNegocio);
      expect(resultados[0]!.status).toBe("rejected");
      expect(await estado(r.id)).toBe("expirada");
      expect(await vigentes(r.id)).toBe(0);
      expect(await reportesDe(r.id)).toBe(0);
    }
    expect(await archivos()).toHaveLength(0);
  });

  test("regenerar el enlace contra un reporte con el enlace anterior: el anterior queda invalidado", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const r = await escenario(100_000);
      const desde = abiertos.length;
      const [reportar, regenerar] = await Promise.allSettled([
        propio().reportes.report(r.token, envio(1000), jpeg()),
        propio().reservas.regenerateToken(r.id, { actorUserId: admin, reason: "x" }),
      ]);
      await cerrarDesde(desde);
      soloNegocio(reportar!);
      expect(regenerar!.status).toBe("fulfilled");
      if (reportar!.status === "rejected") expect(reportar!.reason).toBeInstanceOf(NotFoundError);
      expect(await reportesDe(r.id)).toBe(reportar!.status === "fulfilled" ? 1 : 0);
      await expect(propio().reportes.report(r.token, envio(1000), jpeg())).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await cerrarDesde(desde);
    }
  });

  test("reportes, cancelaciones, expiraciones y asignaciones cruzadas entre salidas y cuentas: sin interbloqueos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      await sql`delete from payment_reports`;
      await sql`delete from bank_allocations`;
      await sql`delete from bank_accounts`;
      const cuentas = [
        await sembrarCuenta(sql, { priority: 1, limite: 300_000 }),
        await sembrarCuenta(sql, { priority: 2, limite: 300_000 }),
        await sembrarCuenta(sql, { priority: 3, limite: 300_000 }),
      ];
      const tareas: Array<() => Promise<unknown>> = [];
      for (let i = 0; i < 4; i++) {
        const vieja = await sembrarReservaConToken(sql, {
          monto: 10_000,
          expiraEn: new Date(Date.now() - 60_000),
        });
        await sembrarAsignacionDe(sql, vieja.id, cuentas[i % 3]!, 10_000);
        const viva = await sembrarReservaConToken(sql, {
          monto: 10_000,
          departureId: vieja.departureId,
        });
        await sembrarAsignacionDe(sql, viva.id, cuentas[(i + 1) % 3]!, 10_000);
        const aCancelar = await sembrarReservaConToken(sql, {
          monto: 10_000,
          departureId: vieja.departureId,
        });
        await sembrarAsignacionDe(sql, aCancelar.id, cuentas[(i + 2) % 3]!, 10_000);
        const nueva = await sembrarReservaConToken(sql, {
          monto: 10_000,
          departureId: vieja.departureId,
        });
        tareas.push(
          () => propio().reportes.report(viva.token, envio(1000), jpeg()),
          () => propio().reservas.cancel(aCancelar.id, { actorUserId: admin, reason: "x" }),
          () => propio().asignaciones.requestInstructions(nueva.token),
        );
      }
      const desde = abiertos.length;
      const resultados = await Promise.allSettled(tareas.map((t) => t()));
      await cerrarDesde(desde);
      resultados.forEach(soloNegocio);
      expect(resultados.every((r) => r.status === "fulfilled")).toBe(true);
      // Nada vencido ni cancelado sin comprobantes sigue consumiendo; los reportes quedaron pendientes.
      expect(
        await n(
          sql`select count(*)::int as n from bank_allocations a join bookings b on b.id = a.booking_id
            where a.status = 'vigente' and b.status in ('expirada', 'cancelada')`,
        ),
      ).toBe(0);
      expect(await n(sql`select count(*)::int as n from payment_reports`)).toBe(4);
    }
  });
});
