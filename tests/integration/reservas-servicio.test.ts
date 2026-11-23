import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { BusinessRuleError, ConflictError } from "@lib/errors";
import { crearReservas } from "@modules/bookings/container";
import { DrizzleBookingRepository } from "@modules/bookings/infrastructure/drizzle-booking-repository";
import { BookingService } from "@modules/bookings/application/booking-service";
import type { SolicitudReserva } from "@modules/bookings/domain/booking-rules";
import { departures } from "@modules/catalog/schema";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

// Igual que reservas-esquema.test.ts: en local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("BookingService sobre PostgreSQL real", () => {
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

  const { bookings } = crearReservas(db);
  let contador = 0;

  // Paquete publicado + salida publicada futura + un punto asignado.
  const nuevaSalida = async (capacity: number, salida: Record<string, unknown> = {}) => {
    const n = ++contador;
    const [p] = await sql`insert into packages (name, summary, description, status)
      values (${"Paquete " + n}, 'Resumen', 'Descripción', 'publicado') returning id`;
    const [d] = await sql`insert into departures
      (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents,
       infant_price_cents, status)
      values (${p.id}, ${salida.startsAt ?? "2099-01-10T10:00:00Z"}, '2099-01-12T10:00:00Z', ${capacity},
              150000, 100000, 0, 'publicada') returning id`;
    const [b] = await sql`insert into boarding_points (name) values (${"Punto " + n}) returning id`;
    await sql`insert into departure_boarding_points (departure_id, boarding_point_id)
      values (${d.id}, ${b.id})`;
    return { departureId: d.id as string, boardingPointId: b.id as string };
  };

  const solicitud = (
    s: { departureId: string; boardingPointId: string },
    categorias: SolicitudReserva["passengers"][number]["fareCategory"][] = ["adulto"],
  ): SolicitudReserva => ({
    ...s,
    buyerName: "Ana",
    buyerPhone: "5555555555",
    buyerEmail: "ana@example.com",
    passengers: categorias.map((fareCategory, i) => ({ fullName: `Pasajero ${i}`, fareCategory })),
  });

  const retenidos = async (departureId: string) => {
    const [fila] = await sql`select count(p.id)::int as n from booking_passengers p
      join bookings b on b.id = p.booking_id where b.departure_id = ${departureId}`;
    return fila.n as number;
  };
  const filasDe = async (departureId: string) => {
    const [fila] = await sql`select
      (select count(*) from bookings where departure_id = ${departureId})::int as reservas,
      (select count(*) from booking_passengers p join bookings b on b.id = p.booking_id
         where b.departure_id = ${departureId})::int as pasajeros,
      (select count(*) from booking_events e join bookings b on b.id = e.booking_id
         where b.departure_id = ${departureId})::int as eventos`;
    return fila as { reservas: number; pasajeros: number; eventos: number };
  };

  test("no sobrevende: 12 solicitudes simultáneas (más que el pool) para 5 lugares aceptan solo 5", async () => {
    const s = await nuevaSalida(5);
    const resultados = await Promise.allSettled(
      Array.from({ length: 12 }, () => bookings.create(solicitud(s))),
    );
    const aceptadas = resultados.filter((r) => r.status === "fulfilled");
    const rechazadas = resultados.filter((r) => r.status === "rejected");
    expect(aceptadas).toHaveLength(5);
    expect(rechazadas).toHaveLength(7);
    for (const r of rechazadas) {
      expect(r.reason).toBeInstanceOf(ConflictError);
      expect(r.reason.code).toBe("capacity_exceeded");
    }
    expect(await retenidos(s.departureId)).toBe(5);
  });

  test("con grupos de tamaño distinto nunca se supera la capacidad (infantes incluidos)", async () => {
    const s = await nuevaSalida(10);
    const grupos: SolicitudReserva["passengers"][number]["fareCategory"][][] = [
      ["adulto", "menor", "infante"],
      ["infante", "infante", "infante", "infante"],
      ["adulto", "adulto", "adulto"],
      ["menor", "infante"],
      ["adulto", "adulto", "adulto", "infante"],
      ["infante", "infante", "infante"],
    ];
    const resultados = await Promise.allSettled(
      grupos.map((g) => bookings.create(solicitud(s, g))),
    );
    for (const r of resultados) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
    }
    const total = await retenidos(s.departureId);
    expect(total).toBeLessThanOrEqual(10);
    // Lo aceptado es exactamente lo retenido y no cabía ningún grupo rechazado en lo que quedó.
    const aceptados = resultados.flatMap((r, i) => (r.status === "fulfilled" ? [grupos[i]!] : []));
    expect(total).toBe(aceptados.reduce((suma, g) => suma + g.length, 0));
    for (const [i, r] of resultados.entries()) {
      if (r.status === "rejected") expect(total + grupos[i]!.length).toBeGreaterThan(10);
    }
  });

  test("una reserva pendiente vencida no ocupa lugar aunque no esté materializada", async () => {
    const s = await nuevaSalida(2);
    const { booking } = await bookings.create(solicitud(s, ["adulto", "adulto"]));
    await expect(bookings.create(solicitud(s))).rejects.toBeInstanceOf(ConflictError);
    await sql`update bookings set expires_at = now() - interval '1 minute' where id = ${booking.id}`;
    await bookings.create(solicitud(s, ["adulto", "adulto"]));
    // En revisión retiene siempre, aunque su plazo ya pasó.
    await sql`update bookings set status = 'en_revision' where id = ${booking.id}`;
    await expect(bookings.create(solicitud(s))).rejects.toBeInstanceOf(ConflictError);
  });

  test("el precio queda congelado aunque después se edite la tarifa", async () => {
    const s = await nuevaSalida(5);
    const { booking } = await bookings.create(solicitud(s, ["adulto", "menor", "infante"]));
    await db
      .update(departures)
      .set({ adultPriceCents: 999999 })
      .where(eq(departures.id, s.departureId));
    const pasajeros = await sql`select fare_category, price_snapshot_cents from booking_passengers
      where booking_id = ${booking.id} order by price_snapshot_cents desc`;
    expect(pasajeros.map((p: { price_snapshot_cents: number }) => p.price_snapshot_cents)).toEqual([
      150000, 100000, 0,
    ]);
    const [fila] = await sql`select total_cents from bookings where id = ${booking.id}`;
    expect(fila.total_cents).toBe(250000);
  });

  test("expires_at nunca supera starts_at", async () => {
    const empieza = new Date(Date.now() + 3 * 3_600_000);
    const s = await nuevaSalida(5, { startsAt: empieza.toISOString() });
    const { booking } = await bookings.create(solicitud(s));
    expect(booking.expiresAt.getTime()).toBe(empieza.getTime());
  });

  test("punto no asignado, salida no publicada o paquete no publicado: 422 sin dejar filas", async () => {
    const s = await nuevaSalida(5);
    const [ajeno] = await sql`insert into boarding_points (name) values ('Ajeno') returning id`;
    await expect(
      bookings.create({ ...solicitud(s), boardingPointId: ajeno.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await filasDe(s.departureId)).toEqual({ reservas: 0, pasajeros: 0, eventos: 0 });

    await sql`update departures set status = 'cancelada' where id = ${s.departureId}`;
    await expect(bookings.create(solicitud(s))).rejects.toBeInstanceOf(BusinessRuleError);
    await sql`update departures set status = 'publicada' where id = ${s.departureId}`;
    await sql`update packages set status = 'archivado'
      where id = (select package_id from departures where id = ${s.departureId})`;
    await expect(bookings.create(solicitud(s))).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await filasDe(s.departureId)).toEqual({ reservas: 0, pasajeros: 0, eventos: 0 });
  });

  test("si falla una escritura a mitad de la transacción, se revierte todo (rollback)", async () => {
    const s = await nuevaSalida(5);
    const real = new DrizzleBookingRepository(db);
    const roto = new BookingService(
      {
        findByTokenHash: real.findByTokenHash.bind(real),
        transaction: (fn) =>
          real.transaction((tx) =>
            fn({
              ...tx,
              insertarEvento: () => Promise.reject(new Error("fallo simulado")),
            }),
          ),
      },
      { holdHours: 24 },
    );
    await expect(roto.create(solicitud(s))).rejects.toThrow("fallo simulado");
    expect(await filasDe(s.departureId)).toEqual({ reservas: 0, pasajeros: 0, eventos: 0 });
    // El bloqueo se liberó con el rollback: una reserva posterior no se cuelga.
    await bookings.create(solicitud(s));
  });

  test("ninguna fila contiene el token en claro; solo su hash SHA-256", async () => {
    const s = await nuevaSalida(5);
    const { booking, token } = await bookings.create(solicitud(s));
    const [fila] = await sql`select
      (select to_jsonb(b)::text from bookings b where id = ${booking.id}) as reserva,
      (select coalesce(string_agg(to_jsonb(p)::text, ''), '') from booking_passengers p
         where booking_id = ${booking.id}) as pasajeros,
      (select coalesce(string_agg(to_jsonb(e)::text, ''), '') from booking_events e
         where booking_id = ${booking.id}) as eventos`;
    expect(`${fila.reserva}${fila.pasajeros}${fila.eventos}`).not.toContain(token);
    expect(booking.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const [evento] = await sql`select type, actor_type, to_status, actor_user_id
      from booking_events where booking_id = ${booking.id}`;
    expect(evento).toMatchObject({
      type: "creada",
      actor_type: "comprador",
      to_status: "pendiente",
    });
  });

  // Comportamiento de `bun-sql` (ADR-015): FOR UPDATE serializa transacciones concurrentes de
  // conexiones distintas del pool y el rollback libera el bloqueo.
  describe("bun-sql: transacciones concurrentes y bloqueos", () => {
    const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const bloquear = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) =>
      tx.select({ id: departures.id }).from(departures).where(eq(departures.id, id)).for("update");

    test("la segunda transacción espera al commit de la primera", async () => {
      const s = await nuevaSalida(1);
      const orden: string[] = [];
      const a = db.transaction(async (tx) => {
        await bloquear(tx, s.departureId);
        orden.push("A bloquea");
        await dormir(400);
        orden.push("A confirma");
      });
      await dormir(100);
      const b = db.transaction(async (tx) => {
        orden.push("B pide");
        await bloquear(tx, s.departureId);
        orden.push("B bloquea");
      });
      await Promise.all([a, b]);
      expect(orden).toEqual(["A bloquea", "B pide", "A confirma", "B bloquea"]);
    });

    test("el rollback de la primera libera el bloqueo para la segunda", async () => {
      const s = await nuevaSalida(1);
      const orden: string[] = [];
      const a = db
        .transaction(async (tx) => {
          await bloquear(tx, s.departureId);
          await dormir(300);
          orden.push("A revierte");
          throw new Error("rollback");
        })
        .catch(() => {});
      await dormir(100);
      const b = db.transaction(async (tx) => {
        await bloquear(tx, s.departureId);
        orden.push("B bloquea");
      });
      await Promise.all([a, b]);
      expect(orden).toEqual(["A revierte", "B bloquea"]);
    });
  });
});
