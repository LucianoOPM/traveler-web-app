import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { BusinessRuleError, ConflictError, NotFoundError } from "@lib/errors";
import { generarToken } from "@modules/bookings/domain/access-token";
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
import { jpeg, jpegDe, pdf, pdfDe } from "../support/imagenes";

// Reporte SPEI del comprador con PostgreSQL real y un directorio temporal para las evidencias (una
// sola conexión; la concurrencia está en `reportes-concurrencia.test.ts`).
const base = abrirBaseDePruebas();
const CINCO_MIB = 5 * 1024 * 1024;

describe.skipIf(!base && !process.env.CI)("reporte SPEI: servicio", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  let carpeta = "";
  let admin = "";
  const ahora = () => new Date();
  let reportes!: PaymentReportService;
  let asignaciones!: BankAllocationService;
  let reservas!: BookingService;

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    carpeta = await mkdtemp(path.join(tmpdir(), "traveltech-reportes-"));
    const media = new MediaService(new DrizzleMediaRepository(db), new AlmacenEnDisco(carpeta));
    reportes = new PaymentReportService(new DrizzlePaymentReportRepository(db), media, ahora);
    asignaciones = new BankAllocationService(new DrizzleBankAllocationRepository(db), ZONA, ahora);
    reservas = new BookingService(new DrizzleBookingRepository(db), { holdHours: 24, ahora });
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-reportes@example.test', now(), now()) returning id`;
    admin = u.id;
  });
  beforeEach(async () => {
    await sql`delete from audit_events`;
    await sql`delete from payment_reviews`;
    await sql`delete from payment_reports`;
    await sql`delete from cash_payments`;
    await sql`delete from admin_cases`;
    await sql`delete from bank_allocations`;
    await sql`delete from bank_accounts`;
    await sql`delete from media_assets`;
    await rm(path.join(carpeta, "media"), { recursive: true, force: true });
  });
  afterAll(async () => {
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
  const clave = () => crypto.randomUUID();
  const datos = (amountCents: number, extra: Record<string, unknown> = {}) => ({
    requestKey: clave(),
    amountCents,
    ...extra,
  });
  const reportesDe = (reservaId: string) =>
    sql`select * from payment_reports where booking_id = ${reservaId} order by submitted_at, id`;
  const estado = async (reservaId: string) =>
    (await sql`select status, expires_at from bookings where id = ${reservaId}`)[0]!;
  const eventos = (reservaId: string, tipo: string) =>
    n(
      sql`select count(*)::int as n from booking_events
        where booking_id = ${reservaId} and type = ${tipo}`,
    );
  /** Reserva con cuenta y asignación vigente, lista para reportar. */
  const escenario = async (monto = 100_000, estadoReserva = "pendiente") => {
    const cuenta = await sembrarCuenta(sql);
    const r = await sembrarReservaConToken(sql, { monto, estado: estadoReserva });
    const asignacion = await sembrarAsignacionDe(sql, r.id, cuenta, monto);
    return { ...r, cuenta, asignacion };
  };
  const escrituras = async () => {
    const [f] = await sql`select
      (select count(*) from payment_reports)::int as r, (select count(*) from media_assets)::int as m,
      (select count(*) from booking_events)::int as e, (select count(*) from audit_events)::int as u,
      (select count(*) from bank_allocations)::int as a, (select count(*) from admin_cases)::int as c,
      (select count(*) from bookings where status = 'expirada')::int as x`;
    return JSON.stringify(f);
  };

  describe("reportar", () => {
    test("crea un reporte pendiente, deja la reserva en revisión y no toca vencimiento, saldo ni comprometido", async () => {
      const r = await escenario(100_000);
      const antes = await estado(r.id);

      const res = await reportes.report(
        r.token,
        datos(40_000, { trackingReference: "ABC123" }),
        pdf(),
      );

      expect(res).toMatchObject({
        amountCents: 40_000,
        status: "pendiente",
        pendingCents: 100_000,
      });
      const [rep] = await reportesDe(r.id);
      expect(rep).toMatchObject({
        status: "pendiente",
        reported_amount_cents: 40_000,
        tracking_reference: "ABC123",
        bank_allocation_id: r.asignacion, // misma asignación para todos los SPEI
      });
      const despues = await estado(r.id);
      expect(despues.status).toBe("en_revision");
      expect(despues.expires_at).toEqual(antes.expires_at); // no renueva el vencimiento
      expect(await eventos(r.id, "pago_reportado")).toBe(1);
      const [asset] = await sql`select content_type, size_bytes from media_assets`;
      expect(asset).toMatchObject({ content_type: "application/pdf", size_bytes: pdf().length });
      expect(await archivos()).toHaveLength(1);
      // Un reporte no es ingreso: ni review, ni saldo, ni límite consumido por el reporte.
      expect(await n(sql`select count(*)::int as n from payment_reviews`)).toBe(0);
      expect((await asignaciones.find(r.token))?.pendingCents).toBe(100_000);
      expect(
        await n(
          sql`select coalesce(sum(amount_cents), 0)::int as n from bank_allocations where status = 'vigente'`,
        ),
      ).toBe(100_000);
    });

    test("audita al comprador solo con campos permitidos: sin token, referencia ni ruta", async () => {
      const r = await escenario();
      await reportes.report(
        r.token,
        datos(1000, { trackingReference: "CLAVE-SECRETA-99" }),
        jpeg(),
      );
      const [a] = await sql`select actor_type, actor_user_id, action, after from audit_events`;
      expect(a).toMatchObject({
        actor_type: "comprador",
        actor_user_id: null,
        action: "payment_report.created",
      });
      const texto = JSON.stringify(a.after);
      expect(texto).not.toContain("CLAVE-SECRETA-99");
      expect(texto).not.toContain(r.token);
      expect(texto).not.toContain("media/");
      expect(a.after).toMatchObject({ reportedAmountCents: 1000, hasTrackingReference: true });
    });

    test("dos reportes legítimos del mismo importe coexisten, cada uno con su evidencia", async () => {
      const r = await escenario(100_000);
      await reportes.report(r.token, datos(30_000), jpeg());
      await reportes.report(r.token, datos(30_000), jpeg());
      expect(await reportesDe(r.id)).toHaveLength(2);
      expect(await archivos()).toHaveLength(2);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(2);
      expect((await estado(r.id)).status).toBe("en_revision");
      expect(await eventos(r.id, "pago_reportado")).toBe(2);
      expect((await asignaciones.find(r.token))?.pendingCents).toBe(100_000);
    });

    test("la referencia opcional vacía o de espacios se guarda como null y se recorta", async () => {
      const r = await escenario();
      await reportes.report(r.token, datos(1000, { trackingReference: "" }), jpeg());
      await reportes.report(r.token, datos(1000, { trackingReference: "   " }), jpeg());
      await reportes.report(r.token, datos(1000, { trackingReference: "  RAS-1  " }), jpeg());
      const filas = await reportesDe(r.id);
      expect(filas.map((f: { tracking_reference: string | null }) => f.tracking_reference)).toEqual(
        [null, null, "RAS-1"],
      );
      await expect(
        reportes.report(r.token, datos(1000, { trackingReference: "x".repeat(41) }), jpeg()),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });

    test("desde parcial pasa a en_revision y desde en_revision se queda", async () => {
      const parcial = await escenario(100_000, "parcial");
      await reportes.report(parcial.token, datos(1000), jpeg());
      expect((await estado(parcial.id)).status).toBe("en_revision");
      const revision = await escenario(100_000, "en_revision");
      await reportes.report(revision.token, datos(1000), jpeg());
      expect((await estado(revision.id)).status).toBe("en_revision");
    });
  });

  describe("importe y estado", () => {
    test("importe hasta el saldo inclusive; uno más, cero o negativo → 422 sin dejar archivos ni filas", async () => {
      const r = await escenario(100_000);
      const antes = await escrituras();
      for (const importe of [100_001, 0, -5]) {
        await expect(reportes.report(r.token, datos(importe), jpeg())).rejects.toBeInstanceOf(
          BusinessRuleError,
        );
      }
      expect(await escrituras()).toBe(antes);
      expect(await archivos()).toEqual([]);
      await reportes.report(r.token, datos(100_000), jpeg()); // exactamente el saldo
      expect(await reportesDe(r.id)).toHaveLength(1);
    });

    test("el saldo descuenta el efectivo y los SPEI verificados, no los pendientes", async () => {
      const r = await escenario(100_000, "parcial");
      await sql`insert into cash_payments (booking_id, amount_cents, recorded_by)
        values (${r.id}, 30_000, ${admin})`;
      await expect(reportes.report(r.token, datos(70_001), jpeg())).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
      // Un pendiente no reduce el saldo: se puede reportar otra vez hasta el saldo completo.
      await reportes.report(r.token, datos(70_000), jpeg());
      await reportes.report(r.token, datos(70_000), jpeg());
      expect(await reportesDe(r.id)).toHaveLength(2);
    });

    test("sin asignación vigente → 409 sin archivos ni filas", async () => {
      const r = await sembrarReservaConToken(sql, { monto: 50_000 });
      const error = await reportes.report(r.token, datos(1000), jpeg()).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe("no_allocation");
      expect(await archivos()).toEqual([]);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(0);
    });

    test("pagada, cancelada y expirada no pueden reportar", async () => {
      for (const e of ["pagada", "cancelada", "expirada"]) {
        const r = await escenario(50_000, e);
        await expect(reportes.report(r.token, datos(1000), jpeg())).rejects.toBeInstanceOf(
          ConflictError,
        );
        expect(await reportesDe(r.id)).toHaveLength(0);
      }
      expect(await archivos()).toEqual([]);
    });

    test("una pendiente vencida conserva la expiración materializada aunque su reporte se rechace", async () => {
      const cuenta = await sembrarCuenta(sql);
      const r = await sembrarReservaConToken(sql, {
        monto: 50_000,
        expiraEn: new Date(Date.now() - 60_000),
      });
      await sembrarAsignacionDe(sql, r.id, cuenta, 50_000);

      await expect(reportes.report(r.token, datos(1000), jpeg())).rejects.toBeInstanceOf(
        ConflictError,
      );

      expect((await estado(r.id)).status).toBe("expirada"); // la expiración persiste
      expect(await eventos(r.id, "expirada")).toBe(1);
      expect(
        (await sql`select status from bank_allocations where booking_id = ${r.id}`)[0]!.status,
      ).toBe("liberada");
      expect(await reportesDe(r.id)).toHaveLength(0);
      expect(await archivos()).toEqual([]);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(0);
    });
  });

  describe("evidencia", () => {
    test("5 MiB exactos se aceptan; 5 MiB más un byte, firma falsa y truncados se rechazan sin huérfanos", async () => {
      const r = await escenario(100_000);
      await reportes.report(r.token, datos(1000), pdfDe(CINCO_MIB));
      expect(await archivos()).toHaveLength(1);
      for (const malo of [
        pdfDe(CINCO_MIB + 1),
        new TextEncoder().encode("<html>%PDF-1.4 %%EOF</html>"),
        pdf().slice(0, 12),
        new Uint8Array(),
      ]) {
        await expect(reportes.report(r.token, datos(1000), malo)).rejects.toBeInstanceOf(
          BusinessRuleError,
        );
      }
      expect(await archivos()).toHaveLength(1);
      expect(await reportesDe(r.id)).toHaveLength(1);
    });

    test("solo es evidencia el archivo de un reporte: una portada u otro archivo da 404", async () => {
      const r = await escenario();
      await reportes.report(r.token, datos(1000), pdf());
      const [{ evidence_asset_id: evidencia }] = await reportesDe(r.id);
      const { asset, bytes } = await reportes.evidence(evidencia);
      expect(asset.contentType).toBe("application/pdf");
      expect(bytes.length).toBe(pdf().length);

      const [portada] = await sql`insert into media_assets (storage_key, content_type, size_bytes)
        values ('media/portada.jpg', 'image/jpeg', 10) returning id`;
      await expect(reportes.evidence(portada.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(reportes.evidence(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("token", () => {
    test("token inexistente o mal formado: 404 sin escribir archivos", async () => {
      await escenario();
      for (const token of ["", "corto", "x".repeat(43), generarToken()]) {
        await expect(reportes.report(token, datos(1000), jpeg())).rejects.toBeInstanceOf(
          NotFoundError,
        );
      }
      expect(await archivos()).toEqual([]);
    });

    test("regenerar el enlace invalida el anterior para reportar", async () => {
      const r = await escenario();
      const { token } = await reservas.regenerateToken(r.id, { actorUserId: admin, reason: "x" });
      await expect(reportes.report(r.token, datos(1000), jpeg())).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await reportes.report(token, datos(1000), jpeg());
      expect(await reportesDe(r.id)).toHaveLength(1);
    });

    test("el comprador solo ve los reportes de su propia reserva", async () => {
      const a = await escenario(100_000);
      const b = await escenario(100_000);
      await reportes.report(a.token, datos(1000), jpeg());
      await reportes.report(b.token, datos(2000), jpeg());
      await reportes.report(b.token, datos(3000), jpeg());
      expect((await reportes.list(a.token)).map((x) => x.reportedAmountCents)).toEqual([1000]);
      expect((await reportes.list(b.token)).map((x) => x.reportedAmountCents).sort()).toEqual([
        2000, 3000,
      ]);
      expect(await reportes.list(generarToken())).toEqual([]);
      expect(await reportes.list("malformado")).toEqual([]);
      // La lista no expone ids ni rutas de archivos.
      expect(Object.keys((await reportes.list(a.token))[0]!).sort()).toEqual([
        "reportedAmountCents",
        "status",
        "submittedAt",
        "verifiedAmountCents",
      ]);
    });
  });

  describe("idempotencia", () => {
    test("repetir el mismo envío (misma clave y datos) no crea otro reporte, archivo, evento ni auditoría", async () => {
      const r = await escenario(100_000);
      const envio = datos(25_000, { trackingReference: "REF-1" });
      const uno = await reportes.report(r.token, envio, jpeg());
      const dos = await reportes.report(r.token, envio, jpeg());
      expect(dos).toEqual(uno);
      expect(await reportesDe(r.id)).toHaveLength(1);
      expect(await archivos()).toHaveLength(1);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(1);
      expect(await eventos(r.id, "pago_reportado")).toBe(1);
      expect(await n(sql`select count(*)::int as n from audit_events`)).toBe(1);
    });

    test("el reintento devuelve el reporte original aunque la reserva ya haya cambiado de estado", async () => {
      const r = await escenario(100_000);
      const envio = datos(25_000);
      const uno = await reportes.report(r.token, envio, jpeg());
      await sql`update bookings set status = 'pagada' where id = ${r.id}`;
      expect(await reportes.report(r.token, envio, jpeg())).toMatchObject({
        amountCents: uno.amountCents,
        status: "pendiente",
      });
      expect(await reportesDe(r.id)).toHaveLength(1);
      expect(await archivos()).toHaveLength(1);
    });

    test("reutilizar la clave con datos distintos → 409 sin otro reporte ni archivo", async () => {
      const r = await escenario(100_000);
      const envio = datos(25_000);
      await reportes.report(r.token, envio, jpeg());
      for (const [cambio, bytes] of [
        [{ amountCents: 26_000 }, jpeg()],
        [{ trackingReference: "otra" }, jpeg()],
        [{}, pdf()],
      ] as const) {
        const error = await reportes
          .report(r.token, { ...envio, ...cambio }, bytes)
          .catch((e) => e);
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.code).toBe("idempotency_key_reused");
      }
      expect(await reportesDe(r.id)).toHaveLength(1);
      expect(await archivos()).toHaveLength(1);
    });
  });

  describe("idempotencia por contenido de la evidencia", () => {
    const distinto = (bytes: Uint8Array) => {
      const copia = new Uint8Array(bytes);
      copia[500] = copia[500] === 0x42 ? 0x43 : 0x42; // mismo tamaño y tipo, un byte distinto
      return copia;
    };

    test("misma clave y mismos bytes (otra copia del archivo) → resultado idempotente sin nada nuevo", async () => {
      const r = await escenario(100_000);
      const envio = datos(25_000, { trackingReference: "REF-1" });
      const original = jpegDe(2048);
      const uno = await reportes.report(r.token, envio, original);
      const eventosAntes = await eventos(r.id, "pago_reportado");
      const dos = await reportes.report(r.token, envio, new Uint8Array(original));
      expect(dos).toEqual(uno);
      expect(await reportesDe(r.id)).toHaveLength(1);
      expect(await archivos()).toHaveLength(1);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(1);
      expect(await eventos(r.id, "pago_reportado")).toBe(eventosAntes);
      expect(await n(sql`select count(*)::int as n from audit_events`)).toBe(1);
    });

    test("misma clave y archivo distinto del mismo tamaño y tipo → 409, sin reporte, archivo ni evento nuevos", async () => {
      const r = await escenario(100_000);
      const envio = datos(25_000);
      const original = jpegDe(2048);
      await reportes.report(r.token, envio, original);
      const auditoriaAntes = await n(sql`select count(*)::int as n from audit_events`);
      const eventosAntes = await eventos(r.id, "pago_reportado");

      const falso = distinto(original);
      expect(falso.length).toBe(original.length);
      const error = await reportes.report(r.token, envio, falso).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe("idempotency_key_reused");
      expect(await reportesDe(r.id)).toHaveLength(1);
      expect(await archivos()).toHaveLength(1);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(1);
      expect(await eventos(r.id, "pago_reportado")).toBe(eventosAntes);
      expect(await n(sql`select count(*)::int as n from audit_events`)).toBe(auditoriaAntes);
    });

    test("claves distintas con evidencia idéntica → reportes independientes", async () => {
      const r = await escenario(100_000);
      const evidencia = jpegDe(2048);
      await reportes.report(r.token, datos(10_000), evidencia);
      await reportes.report(r.token, datos(10_000), new Uint8Array(evidencia));
      expect(await reportesDe(r.id)).toHaveLength(2);
      expect(await archivos()).toHaveLength(2);
      expect(await n(sql`select count(*)::int as n from media_assets`)).toBe(2);
      expect(await eventos(r.id, "pago_reportado")).toBeGreaterThanOrEqual(2);
    });

    test("el archivo original ilegible se trata como distinto (409), nunca como el mismo envío", async () => {
      const r = await escenario(100_000);
      const envio = datos(25_000);
      await reportes.report(r.token, envio, jpegDe(2048));
      await rm(path.join(carpeta, "media"), { recursive: true, force: true });
      const error = await reportes.report(r.token, envio, jpegDe(2048)).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(await reportesDe(r.id)).toHaveLength(1);
    });
  });

  describe("atomicidad y lecturas", () => {
    test("un fallo inesperado al auditar revierte todas las escrituras y borra el archivo", async () => {
      const r = await escenario(100_000);
      await sql`create or replace function falla_auditoria() returns trigger as $$
        begin raise exception 'fallo de auditoria simulado'; end; $$ language plpgsql`;
      await sql`create trigger falla_auditoria before insert on audit_events
        for each row execute function falla_auditoria()`;
      const antes = await escrituras();
      try {
        await expect(reportes.report(r.token, datos(1000), jpeg())).rejects.toThrow();
      } finally {
        await sql`drop trigger falla_auditoria on audit_events`;
        await sql`drop function falla_auditoria()`;
      }
      expect(await escrituras()).toBe(antes);
      expect((await estado(r.id)).status).toBe("pendiente");
      expect(await archivos()).toEqual([]);
      await reportes.report(r.token, datos(1000), jpeg()); // sin el fallo, funciona
      expect(await reportesDe(r.id)).toHaveLength(1);
    });

    test("las lecturas (list y find) no escriben nada", async () => {
      const r = await escenario(100_000);
      await reportes.report(r.token, datos(1000), jpeg());
      const vencida = await sembrarReservaConToken(sql, {
        monto: 1000,
        expiraEn: new Date(Date.now() - 60_000),
      });
      const antes = await escrituras();
      await reportes.list(r.token);
      await reportes.list(vencida.token);
      await asignaciones.find(r.token);
      await asignaciones.find(vencida.token);
      expect(await escrituras()).toBe(antes);
    });
  });
});
