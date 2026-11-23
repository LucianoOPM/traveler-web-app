import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

// Igual que catalogo.test.ts: en local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("esquema de reservaciones en traveltech_test", () => {
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
  const nuevoUsuario = async () => {
    const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', ${`admin-${unico()}@example.com`}, now(), now()) returning id`;
    return u.id as string;
  };
  // Reserva válida por defecto; `cambios` pisa columnas para probar cada restricción.
  const nuevaReserva = async (cambios: Record<string, unknown> = {}) => {
    const { departure, punto } = await nuevaSalidaYPunto();
    const r = {
      reference: `TT-${unico()}`,
      departure_id: departure,
      boarding_point_id: punto,
      buyer_name: "Ana",
      buyer_phone: "5555555555",
      buyer_email: "ana@example.com",
      status: "pendiente",
      expires_at: "2027-01-01T00:00:00Z",
      total_cents: 250000,
      access_token_hash: `hash-${unico()}`,
      ...cambios,
    };
    const [fila] = await sql`insert into bookings
      (reference, departure_id, boarding_point_id, buyer_name, buyer_phone, buyer_email,
       status, expires_at, total_cents, access_token_hash)
      values (${r.reference}, ${r.departure_id}, ${r.boarding_point_id}, ${r.buyer_name},
        ${r.buyer_phone}, ${r.buyer_email}, ${r.status}, ${r.expires_at}, ${r.total_cents},
        ${r.access_token_hash}) returning id, status`;
    return fila as { id: string; status: string };
  };
  const nuevoPasajero = (reserva: string, cambios: Record<string, unknown> = {}) => {
    const p = { fare_category: "adulto", price_snapshot_cents: 150000, ...cambios };
    return sql`insert into booking_passengers (booking_id, full_name, fare_category, price_snapshot_cents)
      values (${reserva}, 'Ana Pérez', ${p.fare_category}, ${p.price_snapshot_cents})`;
  };
  const nuevoEvento = (reserva: string, cambios: Record<string, unknown> = {}) => {
    const e = {
      type: "creada",
      actor_type: "comprador",
      actor_user_id: null,
      from_status: null,
      to_status: "pendiente",
      ...cambios,
    };
    return sql`insert into booking_events
      (booking_id, type, actor_type, actor_user_id, from_status, to_status)
      values (${reserva}, ${e.type}, ${e.actor_type}, ${e.actor_user_id}, ${e.from_status}, ${e.to_status})`;
  };

  test("existen las tres tablas", async () => {
    const filas = await sql`select table_name from information_schema.tables
      where table_schema = 'public' and table_name like 'booking%' order by table_name`;
    expect(filas.map((f: { table_name: string }) => f.table_name)).toEqual([
      "booking_events",
      "booking_passengers",
      "bookings",
    ]);
  });

  test("claves foráneas: restrict en salida, punto, evento y usuario; cascade en pasajeros", async () => {
    const fks: Array<{ tabla: string; columna: string; destino: string; borrado: string }> =
      await sql`select c.conrelid::regclass::text as tabla, a.attname as columna,
             c.confrelid::regclass::text as destino, c.confdeltype as borrado
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.conrelid::regclass::text in ('bookings', 'booking_passengers', 'booking_events')
      order by 1, 2`;
    expect(fks).toEqual([
      { tabla: "booking_events", columna: "actor_user_id", destino: '"user"', borrado: "r" },
      { tabla: "booking_events", columna: "booking_id", destino: "bookings", borrado: "r" },
      { tabla: "booking_passengers", columna: "booking_id", destino: "bookings", borrado: "c" },
      { tabla: "bookings", columna: "boarding_point_id", destino: "boarding_points", borrado: "r" },
      { tabla: "bookings", columna: "departure_id", destino: "departures", borrado: "r" },
    ]);
  });

  test("únicos en reference y access_token_hash; índices de consulta", async () => {
    const unicos = await sql`select conname from pg_constraint
      where contype = 'u' and conrelid::regclass::text = 'bookings' order by 1`;
    expect(unicos.map((f: { conname: string }) => f.conname)).toEqual([
      "bookings_access_token_hash_unique",
      "bookings_reference_unique",
    ]);
    const indices = await sql`select indexname, indexdef from pg_indexes
      where indexname in ('bookings_departure_id_status_idx', 'bookings_expires_at_status_idx')
      order by 1`;
    expect(indices[0].indexdef).toContain("(departure_id, status)");
    expect(indices[1].indexdef).toContain("(expires_at, status)");
  });

  test("acepta una reserva válida y su estado por defecto es pendiente", async () => {
    const r = await nuevaReserva();
    await nuevoPasajero(r.id);
    await nuevoEvento(r.id);
    // Sin `status` en el INSERT, la base aplica el valor por defecto.
    const { departure, punto } = await nuevaSalidaYPunto();
    const [porDefecto] = await sql`insert into bookings (reference, departure_id, boarding_point_id,
      buyer_name, buyer_phone, buyer_email, expires_at, total_cents, access_token_hash)
      values (${"TT-" + unico()}, ${departure}, ${punto}, 'Ana', '555', 'a@example.com', now(), 0,
        ${"hash-" + unico()}) returning status`;
    expect(porDefecto.status).toBe("pendiente");
  });

  test("rechaza reference y access_token_hash repetidos", async () => {
    const r = await nuevaReserva({ reference: "TT-REPETIDA", access_token_hash: "hash-repetido" });
    expect(r.id).toBeTruthy();
    await expect(nuevaReserva({ reference: "TT-REPETIDA" })).rejects.toThrow(
      /bookings_reference_unique/,
    );
    await expect(nuevaReserva({ access_token_hash: "hash-repetido" })).rejects.toThrow(
      /bookings_access_token_hash_unique/,
    );
  });

  test("rechaza estado inválido y total negativo", async () => {
    await expect(nuevaReserva({ status: "pagada" })).rejects.toThrow(/bookings_status_check/);
    await expect(nuevaReserva({ total_cents: -1 })).rejects.toThrow(/bookings_total_check/);
  });

  test("rechaza contacto, expires_at o token nulos", async () => {
    for (const columna of ["buyer_name", "buyer_phone", "buyer_email", "expires_at"]) {
      await expect(nuevaReserva({ [columna]: null })).rejects.toThrow(/not-null|null value/i);
    }
  });

  test("pasajeros: categoría válida y precio no negativo", async () => {
    const r = await nuevaReserva();
    for (const categoria of ["adulto", "menor", "infante"]) {
      await nuevoPasajero(r.id, { fare_category: categoria });
    }
    await expect(nuevoPasajero(r.id, { fare_category: "senior" })).rejects.toThrow(
      /booking_passengers_fare_category_check/,
    );
    await expect(nuevoPasajero(r.id, { price_snapshot_cents: -1 })).rejects.toThrow(
      /booking_passengers_price_check/,
    );
  });

  test("eventos: tipo, actor y estados limitados", async () => {
    const r = await nuevaReserva();
    await expect(nuevoEvento(r.id, { type: "pagada" })).rejects.toThrow(
      /booking_events_type_check/,
    );
    await expect(nuevoEvento(r.id, { actor_type: "operador" })).rejects.toThrow(
      /booking_events_actor_type_check/,
    );
    await expect(nuevoEvento(r.id, { from_status: "pagada" })).rejects.toThrow(
      /booking_events_from_status_check/,
    );
    await expect(nuevoEvento(r.id, { to_status: "pagada" })).rejects.toThrow(
      /booking_events_to_status_check/,
    );
    await expect(
      nuevoEvento(r.id, {
        type: "token_regenerado",
        actor_type: "sistema",
        to_status: "pendiente",
      }),
    ).rejects.toThrow(/booking_events_token_check/);
  });

  test("eventos: actor_user_id es obligatorio solo para admin", async () => {
    const r = await nuevaReserva();
    const admin = await nuevoUsuario();
    await expect(nuevoEvento(r.id, { actor_type: "admin" })).rejects.toThrow(
      /booking_events_actor_check/,
    );
    for (const actor of ["comprador", "sistema"]) {
      await expect(nuevoEvento(r.id, { actor_type: actor, actor_user_id: admin })).rejects.toThrow(
        /booking_events_actor_check/,
      );
    }
    await nuevoEvento(r.id, {
      type: "cancelada",
      actor_type: "admin",
      actor_user_id: admin,
      from_status: "pendiente",
      to_status: "cancelada",
    });
    await nuevoEvento(r.id, {
      type: "token_regenerado",
      actor_type: "admin",
      actor_user_id: admin,
      to_status: null,
    });
    await nuevoEvento(r.id, {
      type: "expirada",
      actor_type: "sistema",
      from_status: "pendiente",
      to_status: "expirada",
    });
  });

  test("restrict: no se borra un usuario con eventos ni una reserva con eventos", async () => {
    const r = await nuevaReserva();
    const admin = await nuevoUsuario();
    await nuevoEvento(r.id, { actor_type: "admin", actor_user_id: admin });
    await expect(sql`delete from "user" where id = ${admin}`).rejects.toThrow(/foreign key/i);
    await expect(sql`delete from bookings where id = ${r.id}`).rejects.toThrow(/foreign key/i);
  });

  test("cascade: borrar una reserva sin eventos borra sus pasajeros", async () => {
    const r = await nuevaReserva();
    await nuevoPasajero(r.id);
    await sql`delete from bookings where id = ${r.id}`;
    const [{ n }] = await sql`select count(*)::int as n from booking_passengers
      where booking_id = ${r.id}`;
    expect(n).toBe(0);
  });
});
