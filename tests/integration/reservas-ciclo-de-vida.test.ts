import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { BusinessRuleError, ConflictError } from "@lib/errors";
import { BookingService } from "@modules/bookings/application/booking-service";
import { crearReservas } from "@modules/bookings/container";
import type { SolicitudReserva } from "@modules/bookings/domain/booking-rules";
import { DrizzleBookingRepository } from "@modules/bookings/infrastructure/drizzle-booking-repository";
import { crearCatalogo } from "@modules/catalog/container";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

// Ciclo de vida de las reservas sobre PostgreSQL real, llamando a los servicios (los permisos de las
// Actions se prueban con la app real en `reservas-admin.test.ts`). En local se omite sin
// TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("ciclo de vida de reservas", () => {
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
  const { departures } = crearCatalogo(db);
  let contador = 0;
  let admin = "";
  const MOTIVO = () => ({ actorUserId: admin, reason: "motivo de prueba" });

  beforeAll(async () => {
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-ciclo@example.test', now(), now()) returning id`;
    admin = u.id;
  });

  const nuevaSalida = async (
    capacity: number,
    salida: { status?: string; inicio?: string } = {},
  ) => {
    const n = ++contador;
    const [p] = await sql`insert into packages (name, summary, description, status)
      values (${"Paquete " + n}, 'Resumen', 'Descripción', 'publicado') returning id`;
    const [d] = await sql`insert into departures
      (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents,
       infant_price_cents, status)
      values (${p.id}, ${salida.inicio ?? "2099-01-10T10:00:00Z"}, '2099-01-12T10:00:00Z', ${capacity},
              150000, 100000, 0, ${salida.status ?? "publicada"}) returning id`;
    const [b] = await sql`insert into boarding_points (name) values (${"Punto " + n}) returning id`;
    await sql`insert into departure_boarding_points (departure_id, boarding_point_id)
      values (${d.id}, ${b.id})`;
    return { departureId: d.id as string, boardingPointId: b.id as string };
  };
  const reservar = (s: { departureId: string; boardingPointId: string }, pasajeros = 1) =>
    bookings.create({
      ...s,
      buyerName: "Ana",
      buyerPhone: "5555555555",
      buyerEmail: "ana@example.com",
      passengers: Array.from({ length: pasajeros }, (_, i) => ({
        fullName: `P${i}`,
        fareCategory: "adulto",
      })) satisfies SolicitudReserva["passengers"],
    });
  const vencer = (id: string) =>
    sql`update bookings set expires_at = now() - interval '1 minute' where id = ${id}`;
  const fila = async (id: string) => {
    const [f] =
      await sql`select status, expires_at, access_token_hash from bookings where id = ${id}`;
    return f as { status: string; expires_at: Date; access_token_hash: string };
  };
  const eventos = async (id: string) =>
    (await sql`select type, actor_type, actor_user_id, from_status, to_status, reason
      from booking_events where booking_id = ${id} order by created_at, type`) as {
      type: string;
      actor_type: string;
      actor_user_id: string | null;
      from_status: string | null;
      to_status: string | null;
      reason: string | null;
    }[];
  const tipos = async (id: string) => (await eventos(id)).map((e) => e.type);

  test("expiración perezosa: create materializa las vencidas con su evento «sistema», una sola vez", async () => {
    const s = await nuevaSalida(1);
    const { booking: vieja } = await reservar(s);
    await vencer(vieja.id);
    expect((await fila(vieja.id)).status).toBe("pendiente"); // aún sin materializar
    await reservar(s); // cabe porque la vencida no retiene; el create la materializa
    expect((await fila(vieja.id)).status).toBe("expirada");
    expect(await eventos(vieja.id)).toEqual([
      expect.objectContaining({ type: "creada" }),
      {
        type: "expirada",
        actor_type: "sistema",
        actor_user_id: null,
        from_status: "pendiente",
        to_status: "expirada",
        reason: null,
      },
    ]);
    await reservar(s).catch(() => {}); // otra operación bajo el bloqueo no duplica el evento
    expect(await tipos(vieja.id)).toEqual(["creada", "expirada"]);
  });

  test("en_revision nunca expira: ninguna operación la materializa, aunque su plazo haya pasado", async () => {
    const s = await nuevaSalida(5);
    const { booking: rev } = await reservar(s);
    await sql`update bookings set status = 'en_revision', expires_at = now() - interval '9 days'
      where id = ${rev.id}`;
    await reservar(s);
    await departures.edit(s.departureId, { adultPriceCents: 1 }); // transacción de la salida
    const { booking: otra } = await reservar(s);
    await bookings.cancel(otra.id, MOTIVO());
    expect((await fila(rev.id)).status).toBe("en_revision");
    expect(await tipos(rev.id)).toEqual(["creada"]);
    // Retiene lugar siempre: con capacidad 1 y una en_revision antigua, no cabe otra.
    const lleno = await nuevaSalida(1);
    const { booking: r2 } = await reservar(lleno);
    await sql`update bookings set status = 'en_revision', expires_at = now() - interval '9 days'
      where id = ${r2.id}`;
    await expect(reservar(lleno)).rejects.toMatchObject({ code: "capacity_exceeded" });
  });

  test("política ante rechazos: una operación rechazada conserva las expiraciones materializadas", async () => {
    // 1) create rechazado por capacidad.
    const s1 = await nuevaSalida(3);
    const { booking: a } = await reservar(s1, 2); // retiene 2
    const { booking: vieja1 } = await reservar(s1, 1);
    await vencer(vieja1.id);
    await expect(reservar(s1, 2)).rejects.toMatchObject({ status: 409 }); // 2 + 2 > 3
    expect((await fila(vieja1.id)).status).toBe("expirada");
    expect(await tipos(vieja1.id)).toEqual(["creada", "expirada"]);
    expect((await fila(a.id)).status).toBe("pendiente");
    // El rechazo no dejó reservas nuevas y el inventario es coherente: sigue cabiendo 1.
    const [{ n }] =
      await sql`select count(*)::int as n from bookings where departure_id = ${s1.departureId}`;
    expect(n).toBe(2);
    await reservar(s1, 1);

    // 2) cancelar una expirada (409) con otra vencida en la misma salida.
    const s2 = await nuevaSalida(5);
    const { booking: exp } = await reservar(s2);
    await vencer(exp.id);
    await reservar(s2); // materializa `exp`
    const { booking: vieja2 } = await reservar(s2);
    await vencer(vieja2.id);
    await expect(bookings.cancel(exp.id, MOTIVO())).rejects.toBeInstanceOf(ConflictError);
    expect((await fila(vieja2.id)).status).toBe("expirada");
    expect(await tipos(vieja2.id)).toEqual(["creada", "expirada"]);
    expect(await tipos(exp.id)).toEqual(["creada", "expirada"]); // sin evento «cancelada»

    // 3) reactivar sin capacidad (409): la reserva sigue expirada, las demás vencidas se materializan.
    const s3 = await nuevaSalida(2);
    const { booking: objetivo } = await reservar(s3, 2);
    await vencer(objetivo.id);
    await reservar(s3, 1); // materializa `objetivo`
    await reservar(s3, 1); // la salida queda llena
    const { booking: vieja3 } = await reservar(s3).catch(() => ({ booking: null }));
    expect(vieja3).toBeNull();
    await expect(bookings.reactivate(objetivo.id, MOTIVO())).rejects.toMatchObject({ status: 409 });
    expect((await fila(objetivo.id)).status).toBe("expirada");
    expect(await tipos(objetivo.id)).toEqual(["creada", "expirada"]);

    // 4) cancelar la salida con reservas activas (409, transacción del catálogo) con una vencida.
    const s4 = await nuevaSalida(5);
    await reservar(s4);
    const { booking: vieja4 } = await reservar(s4);
    await vencer(vieja4.id);
    await expect(departures.cancel(s4.departureId)).rejects.toBeInstanceOf(ConflictError);
    expect((await fila(vieja4.id)).status).toBe("expirada");
    expect(await tipos(vieja4.id)).toEqual(["creada", "expirada"]);
  });

  test("un error inesperado revierte todo, incluida la expiración materializada", async () => {
    const s = await nuevaSalida(5);
    const { booking: vieja } = await reservar(s);
    await vencer(vieja.id);
    const { booking: viva } = await reservar(s).then((r) => {
      // `reservar` ya materializó `vieja`: se vuelve a dejar pendiente y vencida para la prueba.
      return r;
    });
    await sql`update bookings set status = 'pendiente', expires_at = now() - interval '1 minute'
      where id = ${vieja.id}`;
    await sql`delete from booking_events where booking_id = ${vieja.id} and type = 'expirada'`;

    const real = new DrizzleBookingRepository(db);
    const roto = new BookingService(
      {
        findByTokenHash: real.findByTokenHash.bind(real),
        listarPorSalida: real.listarPorSalida.bind(real),
        transaction: (fn) =>
          real.transaction((tx) =>
            fn({
              ...tx,
              insertarEvento: (e) =>
                e.type === "expirada"
                  ? tx.insertarEvento(e)
                  : Promise.reject(new Error("fallo simulado")),
            }),
          ),
      },
      { holdHours: 24 },
    );
    await expect(roto.cancel(viva.id, MOTIVO())).rejects.toThrow("fallo simulado");
    expect((await fila(viva.id)).status).toBe("pendiente");
    expect((await fila(vieja.id)).status).toBe("pendiente"); // la expiración también se revirtió
    expect(await tipos(vieja.id)).toEqual(["creada"]);
  });

  test("cancelar: evento con el actor de la sesión, idempotente sin duplicados y 409 desde expirada", async () => {
    const s = await nuevaSalida(5);
    const { booking } = await reservar(s);
    expect(await bookings.cancel(booking.id, MOTIVO())).toEqual({
      status: "cancelada",
      cambio: true,
    });
    expect(await bookings.cancel(booking.id, MOTIVO())).toEqual({
      status: "cancelada",
      cambio: false,
    });
    expect((await fila(booking.id)).status).toBe("cancelada");
    expect(await eventos(booking.id)).toEqual([
      expect.objectContaining({ type: "creada" }),
      {
        type: "cancelada",
        actor_type: "admin",
        actor_user_id: admin,
        from_status: "pendiente",
        to_status: "cancelada",
        reason: "motivo de prueba",
      },
    ]);

    const { booking: vieja } = await reservar(s);
    await vencer(vieja.id);
    await expect(bookings.cancel(vieja.id, MOTIVO())).rejects.toBeInstanceOf(ConflictError);

    // en_revision (fijado por SQL; ninguna Action la asigna en H3) sí se cancela.
    const { booking: rev } = await reservar(s);
    await sql`update bookings set status = 'en_revision' where id = ${rev.id}`;
    await bookings.cancel(rev.id, MOTIVO());
    expect((await eventos(rev.id)).at(-1)).toMatchObject({
      from_status: "en_revision",
      to_status: "cancelada",
    });
  });

  test("el motivo vacío o de solo espacios se rechaza sin tocar nada", async () => {
    const s = await nuevaSalida(5);
    const { booking } = await reservar(s);
    for (const reason of ["", "   ", "x".repeat(501)]) {
      await expect(
        bookings.cancel(booking.id, { actorUserId: admin, reason }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    }
    expect((await fila(booking.id)).status).toBe("pendiente");
    expect(await tipos(booking.id)).toEqual(["creada"]);
  });

  test("reactivar: solo con capacidad y salida válida; repetida no renueva el vencimiento ni crea evento", async () => {
    const s = await nuevaSalida(2);
    const { booking } = await reservar(s, 2);
    await bookings.cancel(booking.id, MOTIVO());
    const { booking: otra } = await reservar(s, 1); // ocupa 1 de 2

    // Cabe 1, necesita 2: 409. Se cancela la otra y entonces sí cabe.
    await expect(bookings.reactivate(booking.id, MOTIVO())).rejects.toMatchObject({
      status: 409,
      code: "capacity_exceeded",
    });
    expect((await fila(booking.id)).status).toBe("cancelada");
    await bookings.cancel(otra.id, MOTIVO());

    const antes = Date.now();
    const r = await bookings.reactivate(booking.id, MOTIVO());
    expect(r.cambio).toBe(true);
    const tras = await fila(booking.id);
    expect(tras.status).toBe("pendiente");
    expect(tras.expires_at.getTime()).toBeGreaterThan(antes + 23 * 3_600_000);
    expect(tras.expires_at.getTime()).toBeLessThanOrEqual(antes + 24 * 3_600_000 + 5_000);

    await new Promise((r) => setTimeout(r, 50));
    const repetida = await bookings.reactivate(booking.id, MOTIVO());
    expect(repetida.cambio).toBe(false);
    expect((await fila(booking.id)).expires_at.getTime()).toBe(tras.expires_at.getTime());
    expect(await tipos(booking.id)).toEqual(["creada", "cancelada", "reactivada"]);
    expect((await eventos(booking.id)).at(-1)).toMatchObject({
      type: "reactivada",
      actor_type: "admin",
      actor_user_id: admin,
      from_status: "cancelada",
      to_status: "pendiente",
    });
  });

  test("reactivar con la salida cancelada o ya iniciada se rechaza (422); el vencimiento nunca supera starts_at", async () => {
    const s = await nuevaSalida(5);
    const { booking } = await reservar(s);
    await bookings.cancel(booking.id, MOTIVO());
    await sql`update departures set status = 'cancelada' where id = ${s.departureId}`;
    await expect(bookings.reactivate(booking.id, MOTIVO())).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await sql`update departures set status = 'publicada', starts_at = now() - interval '1 hour'
      where id = ${s.departureId}`;
    await expect(bookings.reactivate(booking.id, MOTIVO())).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect((await fila(booking.id)).status).toBe("cancelada");

    const empieza = new Date(Date.now() + 3 * 3_600_000);
    const cercana = await nuevaSalida(5, { inicio: empieza.toISOString() });
    const { booking: b2 } = await reservar(cercana);
    await bookings.cancel(b2.id, MOTIVO());
    await bookings.reactivate(b2.id, MOTIVO());
    expect((await fila(b2.id)).expires_at.getTime()).toBe(empieza.getTime());
  });

  test("regenerar token: el anterior deja de funcionar al instante y ningún evento guarda token ni hash", async () => {
    const s = await nuevaSalida(5);
    const { booking, token: viejo } = await reservar(s);
    expect((await bookings.findByToken(viejo))?.reference).toBe(booking.reference);

    const { token: nuevo } = await bookings.regenerateToken(booking.id, MOTIVO());
    expect(await bookings.findByToken(viejo)).toBeNull();
    expect((await bookings.findByToken(nuevo))?.reference).toBe(booking.reference);
    expect((await fila(booking.id)).status).toBe("pendiente");

    const evs = await eventos(booking.id);
    expect(evs.at(-1)).toEqual({
      type: "token_regenerado",
      actor_type: "admin",
      actor_user_id: admin,
      from_status: null,
      to_status: null,
      reason: "motivo de prueba",
    });
    const [{ volcado }] =
      await sql`select coalesce(string_agg(to_jsonb(e)::text, ''), '') as volcado
      from booking_events e where booking_id = ${booking.id}`;
    const hashes = [
      viejo,
      nuevo,
      (await fila(booking.id)).access_token_hash,
      booking.accessTokenHash,
    ];
    for (const secreto of hashes) expect(volcado).not.toContain(secreto);

    // Solo en vigentes: cancelada → 409.
    await bookings.cancel(booking.id, MOTIVO());
    await expect(bookings.regenerateToken(booking.id, MOTIVO())).rejects.toBeInstanceOf(
      ConflictError,
    );
    // en_revision sí.
    const { booking: rev } = await reservar(s);
    await sql`update bookings set status = 'en_revision' where id = ${rev.id}`;
    await bookings.regenerateToken(rev.id, MOTIVO());
  });

  test("la lista de la salida muestra el estado visible y las acciones permitidas", async () => {
    const s = await nuevaSalida(5);
    const { booking: a } = await reservar(s);
    const { booking: b } = await reservar(s);
    await vencer(b.id);
    const { salida, reservas } = await bookings.listByDeparture(s.departureId);
    expect(salida.capacity).toBe(5);
    const por = (id: string) => reservas.find((r) => r.id === id)!;
    expect(por(a.id)).toMatchObject({ status: "pendiente", acciones: ["cancelar", "regenerar"] });
    expect(por(b.id)).toMatchObject({ status: "expirada", acciones: ["reactivar"] });
    expect(por(a.id).buyerEmail).toBe("ana@example.com");
    // La lectura no materializa nada.
    expect((await fila(b.id)).status).toBe("pendiente");
  });
});
