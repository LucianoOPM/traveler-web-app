import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { bankAllocations } from "@db/schema";
import { ESTADOS_RESERVA } from "@modules/bookings/schema";
import { retieneInventario } from "@modules/bookings/domain/booking-rules";
import { pasajerosRetenidos } from "@modules/bookings/infrastructure/reservas-retenidas";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

describe.skipIf(!base && !process.env.CI)("esquema de pagos en traveltech_test", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  });
  afterAll(() => sql.close());

  let contador = 0;
  const unico = () => `${Date.now()}-${++contador}`;

  const nuevaSalidaYPunto = async () => {
    const [p] = await sql`insert into packages (name, summary, description)
      values ('Paquete', 'Resumen', 'Descripción') returning id`;
    const [d] = await sql`insert into departures
      (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents)
      values (${p.id}, '2027-01-10T10:00:00Z', '2027-01-12T10:00:00Z', 40, 150000, 100000, 0)
      returning id`;
    const [b] = await sql`insert into boarding_points (name) values (${"Punto " + unico()})
      returning id`;
    return { departure: d.id as string, punto: b.id as string };
  };
  const nuevaReserva = async (
    status = "pendiente",
    salida?: { departure: string; punto: string },
  ) => {
    const { departure, punto } = salida ?? (await nuevaSalidaYPunto());
    const [r] = await sql`insert into bookings
      (reference, departure_id, boarding_point_id, buyer_name, buyer_phone, buyer_email,
       status, expires_at, total_cents, access_token_hash)
      values (${"TT-" + unico()}, ${departure}, ${punto}, 'Ana', '555', 'a@example.com', ${status},
        '2027-01-01T00:00:00Z', 250000, ${"hash-" + unico()}) returning id`;
    return r.id as string;
  };
  const nuevoUsuario = async () => {
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', ${`admin-${unico()}@example.com`}, now(), now()) returning id`;
    return u.id as string;
  };
  const nuevaCuenta = async (cambios: Record<string, unknown> = {}) => {
    const c = { priority: 1, monthly_limit_cents: 100000000, ...cambios };
    const [fila] = await sql`insert into bank_accounts
      (name, bank_name, account_holder, clabe, priority, monthly_limit_cents)
      values ('Cuenta', 'Banco ficticio', 'Agencia SA', '000000000000000000', ${c.priority},
        ${c.monthly_limit_cents}) returning id`;
    return fila.id as string;
  };
  const nuevaAsignacion = (
    reserva: string,
    cuenta: string,
    cambios: Record<string, unknown> = {},
  ) => {
    const a = {
      amount_cents: 250000,
      calendar_month: "2027-01",
      status: "vigente",
      released_at: null,
      ...cambios,
    };
    return sql`insert into bank_allocations
      (booking_id, bank_account_id, amount_cents, calendar_month, status, instruction_snapshot, released_at)
      values (${reserva}, ${cuenta}, ${a.amount_cents}, ${a.calendar_month}, ${a.status},
        ${{ clabe: "000000000000000000" }}::jsonb, ${a.released_at}) returning id`;
  };
  const nuevoActivo = async () => {
    const [m] = await sql`insert into media_assets (storage_key, content_type, size_bytes)
      values (${"media/" + unico() + ".png"}, 'image/png', 10) returning id`;
    return m.id as string;
  };
  const nuevoReporte = async (
    reserva: string,
    asignacion: string,
    cambios: Record<string, unknown> = {},
  ) => {
    const r = { reported_amount_cents: 100000, status: "pendiente", replaces: null, ...cambios };
    const [fila] = await sql`insert into payment_reports
      (booking_id, bank_allocation_id, reported_amount_cents, evidence_asset_id, status, replaces_report_id)
      values (${reserva}, ${asignacion}, ${r.reported_amount_cents}, ${await nuevoActivo()},
        ${r.status}, ${r.replaces}) returning id`;
    return fila.id as string;
  };
  // Reserva con cuenta, asignación vigente y reporte pendiente.
  const escenario = async () => {
    const reserva = await nuevaReserva();
    const [asig] = await nuevaAsignacion(reserva, await nuevaCuenta());
    const reporte = await nuevoReporte(reserva, asig.id);
    return { reserva, asignacion: asig.id as string, reporte };
  };
  const nuevaRevision = (
    reporte: string,
    reviewer: string,
    cambios: Record<string, unknown> = {},
  ) => {
    const r = { decision: "verificado", verified_amount_cents: 100000, ...cambios };
    return sql`insert into payment_reviews
      (payment_report_id, reviewer_id, decision, verified_amount_cents)
      values (${reporte}, ${reviewer}, ${r.decision}, ${r.verified_amount_cents})`;
  };

  test("existen las seis tablas de pagos y cuentas", async () => {
    const filas = await sql`select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('bank_accounts', 'bank_allocations', 'payment_reports',
          'payment_reviews', 'cash_payments', 'admin_cases') order by table_name`;
    expect(filas.map((f: { table_name: string }) => f.table_name)).toEqual([
      "admin_cases",
      "bank_accounts",
      "bank_allocations",
      "cash_payments",
      "payment_reports",
      "payment_reviews",
    ]);
  });

  test("cuentas: límite mensual positivo", async () => {
    await nuevaCuenta();
    await expect(nuevaCuenta({ monthly_limit_cents: 0 })).rejects.toThrow(
      /bank_accounts_monthly_limit_check/,
    );
  });

  test("asignaciones: importe positivo, mes válido y estado limitado", async () => {
    const reserva = await nuevaReserva();
    const cuenta = await nuevaCuenta();
    await expect(nuevaAsignacion(reserva, cuenta, { amount_cents: 0 })).rejects.toThrow(
      /bank_allocations_amount_check/,
    );
    for (const mes of ["2027-00", "2027-13", "2027-1", "27-01", "2027-01-01"]) {
      await expect(nuevaAsignacion(reserva, cuenta, { calendar_month: mes })).rejects.toThrow(
        /bank_allocations_month_check/,
      );
    }
    await expect(nuevaAsignacion(reserva, cuenta, { status: "otra" })).rejects.toThrow(
      /bank_allocations_status_check/,
    );
  });

  test("asignaciones: released_at solo cuando está liberada", async () => {
    const cuenta = await nuevaCuenta();
    const reserva = await nuevaReserva();
    await expect(
      nuevaAsignacion(reserva, cuenta, { status: "liberada", released_at: null }),
    ).rejects.toThrow(/bank_allocations_released_check/);
    await expect(
      nuevaAsignacion(reserva, cuenta, { status: "vigente", released_at: new Date() }),
    ).rejects.toThrow(/bank_allocations_released_check/);
  });

  test("una sola asignación vigente por reserva; tras liberar se admite otra", async () => {
    const reserva = await nuevaReserva();
    const cuenta = await nuevaCuenta();
    const [primera] = await nuevaAsignacion(reserva, cuenta);
    await expect(nuevaAsignacion(reserva, cuenta)).rejects.toThrow(
      /bank_allocations_booking_vigente_idx/,
    );
    await sql`update bank_allocations set status = 'liberada', released_at = now() where id = ${primera.id}`;
    await nuevaAsignacion(reserva, cuenta);
    // Las liberadas no cuentan: puede haber varias.
    await nuevaAsignacion(reserva, cuenta, { status: "liberada", released_at: new Date() });
  });

  test("instruction_snapshot (jsonb) se guarda y se recupera íntegro con Drizzle y con SQL", async () => {
    const reserva = await nuevaReserva();
    const cuenta = await nuevaCuenta();
    const snapshot = {
      banco: "Banco ficticio",
      clabe: "000000000000000000",
      importeCents: 250000,
      anidado: { lista: [1, "dos", null], ok: true },
    };
    await db.insert(bankAllocations).values({
      bookingId: reserva,
      bankAccountId: cuenta,
      amountCents: 250000,
      calendarMonth: "2027-01",
      instructionSnapshot: snapshot,
    });
    const [viaDrizzle] = await db
      .select()
      .from(bankAllocations)
      .where(eq(bankAllocations.bookingId, reserva));
    expect(viaDrizzle?.instructionSnapshot).toEqual(snapshot);
    // Es un objeto jsonb real, no una cadena con JSON dentro.
    const [crudo] = await sql`select jsonb_typeof(instruction_snapshot) as tipo,
      instruction_snapshot->'anidado'->'lista'->>1 as dos from bank_allocations
      where booking_id = ${reserva}`;
    expect(crudo.tipo).toBe("object");
    expect(crudo.dos).toBe("dos");
  });

  test("reportes: importe positivo, estado limitado y evidencia obligatoria", async () => {
    const { reserva, asignacion } = await escenario();
    await expect(nuevoReporte(reserva, asignacion, { reported_amount_cents: 0 })).rejects.toThrow(
      /payment_reports_amount_check/,
    );
    await expect(nuevoReporte(reserva, asignacion, { status: "otro" })).rejects.toThrow(
      /payment_reports_status_check/,
    );
    await expect(
      sql`insert into payment_reports (booking_id, bank_allocation_id, reported_amount_cents)
        values (${reserva}, ${asignacion}, 100)`,
    ).rejects.toThrow(/evidence_asset_id|null value/i);
  });

  test("un reporte solo puede ser reemplazado una vez y conserva el historial", async () => {
    const { reserva, asignacion, reporte } = await escenario();
    await nuevoReporte(reserva, asignacion, { replaces: reporte });
    await expect(nuevoReporte(reserva, asignacion, { replaces: reporte })).rejects.toThrow(
      /payment_reports_replaces_report_id_unique/,
    );
  });

  test("revisiones: monto positivo si se verifica, nulo si se rechaza, una por reporte", async () => {
    const { reporte } = await escenario();
    const admin = await nuevoUsuario();
    await expect(nuevaRevision(reporte, admin, { verified_amount_cents: 0 })).rejects.toThrow(
      /payment_reviews_amount_check/,
    );
    await expect(nuevaRevision(reporte, admin, { verified_amount_cents: null })).rejects.toThrow(
      /payment_reviews_amount_check/,
    );
    await expect(
      nuevaRevision(reporte, admin, { decision: "rechazado", verified_amount_cents: 100 }),
    ).rejects.toThrow(/payment_reviews_amount_check/);
    await expect(nuevaRevision(reporte, admin, { decision: "otra" })).rejects.toThrow(
      /payment_reviews_(amount|decision)_check/,
    );
    // Verificado por un monto distinto del reportado es válido.
    await nuevaRevision(reporte, admin, { verified_amount_cents: 60000 });
    await expect(
      nuevaRevision(reporte, admin, { decision: "rechazado", verified_amount_cents: null }),
    ).rejects.toThrow(/payment_reviews_payment_report_id_unique/);
  });

  test("cobros en efectivo: importe positivo y registrado por un usuario", async () => {
    const reserva = await nuevaReserva();
    const admin = await nuevoUsuario();
    const insertar = (monto: number, por: string | null) => sql`insert into cash_payments
      (booking_id, amount_cents, recorded_by) values (${reserva}, ${monto}, ${por})`;
    await insertar(50000, admin);
    await expect(insertar(0, admin)).rejects.toThrow(/cash_payments_amount_check/);
    await expect(insertar(-5, admin)).rejects.toThrow(/cash_payments_amount_check/);
    await expect(insertar(100, null)).rejects.toThrow(/recorded_by|null value/i);
  });

  test("casos administrativos: tipo, estado y coherencia de la resolución", async () => {
    const reserva = await nuevaReserva();
    const admin = await nuevoUsuario();
    const insertar = (c: Record<string, unknown>) => {
      const v = {
        type: "sin_cuenta_elegible",
        status: "abierto",
        resolved_by: null,
        resolved_at: null,
        ...c,
      };
      return sql`insert into admin_cases (booking_id, type, status, resolved_by, resolved_at)
        values (${reserva}, ${v.type}, ${v.status}, ${v.resolved_by}, ${v.resolved_at})`;
    };
    await insertar({});
    await insertar({ status: "resuelto", resolved_by: admin, resolved_at: new Date() });
    await expect(insertar({ type: "otro" })).rejects.toThrow(/admin_cases_type_check/);
    await expect(insertar({ status: "otro" })).rejects.toThrow(/admin_cases_status_check/);
    await expect(insertar({ status: "resuelto" })).rejects.toThrow(/admin_cases_resolved_check/);
    await expect(insertar({ resolved_by: admin })).rejects.toThrow(/admin_cases_resolver_check/);
  });

  test("claves foráneas de pagos: todas restrict", async () => {
    const fks: Array<{ borrado: string }> = await sql`select c.confdeltype as borrado
      from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.conrelid::regclass::text in ('bank_allocations', 'payment_reports',
          'payment_reviews', 'cash_payments', 'admin_cases')`;
    expect(fks.length).toBe(12);
    expect(fks.every((f) => f.borrado === "r")).toBe(true);
  });

  test("bookings y booking_events aceptan los estados y tipos nuevos", async () => {
    const admin = await nuevoUsuario();
    for (const estado of ["parcial", "pagada"]) {
      const reserva = await nuevaReserva(estado);
      await sql`insert into booking_events (booking_id, type, actor_type, actor_user_id, from_status, to_status)
        values (${reserva}, 'pago_verificado', 'admin', ${admin}, 'en_revision', ${estado})`;
    }
    const reserva = await nuevaReserva();
    for (const tipo of [
      "pago_reportado",
      "pago_verificado",
      "pago_rechazado",
      "pago_reemplazado",
      "pago_efectivo",
      "cuenta_asignada",
      "cuenta_liberada",
    ]) {
      await sql`insert into booking_events (booking_id, type, actor_type) values (${reserva}, ${tipo}, 'sistema')`;
    }
  });

  // La consulta SQL solo preselecciona; la regla final es `retieneInventario`. Se comprueba, con
  // PostgreSQL real, que ambas coinciden para los seis estados y que la disponibilidad de H3 no cambia.
  test("pasajerosRetenidos coincide con retieneInventario para los seis estados", async () => {
    const ahora = new Date("2026-12-01T00:00:00Z");
    const salida = await nuevaSalidaYPunto();
    let esperados = 0;
    for (const status of ESTADOS_RESERVA) {
      // Una vigente y, para `pendiente`, una vencida (no retiene aunque no esté materializada).
      for (const expires of ["2027-01-01T00:00:00Z", "2026-11-01T00:00:00Z"]) {
        const reserva = await nuevaReserva(status, salida);
        await sql`update bookings set expires_at = ${expires} where id = ${reserva}`;
        await sql`insert into booking_passengers (booking_id, full_name, fare_category, price_snapshot_cents)
          values (${reserva}, 'P1', 'adulto', 1), (${reserva}, 'P2', 'infante', 0)`;
        if (retieneInventario({ status, expiresAt: new Date(expires) }, ahora)) esperados += 2;
      }
    }
    // pendiente vigente + en_revision, parcial y pagada (2 cada una, vigente y vencida) = 2 + 6 * 2
    expect(esperados).toBe(14);
    expect(await pasajerosRetenidos(db, salida.departure, ahora)).toBe(esperados);
  });
});
