import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { BusinessRuleError, ConflictError } from "@lib/errors";
import { crearReservas } from "@modules/bookings/container";
import type { SolicitudReserva } from "@modules/bookings/domain/booking-rules";
import { crearCatalogo } from "@modules/catalog/container";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

// En local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)(
  "disponibilidad y edición de salidas con reservas",
  () => {
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

    const { departures } = crearCatalogo(db);
    const { bookings } = crearReservas(db);
    let contador = 0;

    const nuevaSalida = async (capacity: number) => {
      const n = ++contador;
      const [p] = await sql`insert into packages (name, summary, description, status)
      values (${"Paquete " + n}, 'Resumen', 'Descripción', 'publicado') returning id`;
      const [d] = await sql`insert into departures
      (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents,
       infant_price_cents, status)
      values (${p.id}, '2099-01-10T10:00:00Z', '2099-01-12T10:00:00Z', ${capacity},
              150000, 100000, 0, 'publicada') returning id`;
      const [b] =
        await sql`insert into boarding_points (name) values (${"Punto " + n}) returning id`;
      await sql`insert into departure_boarding_points (departure_id, boarding_point_id)
      values (${d.id}, ${b.id})`;
      return { departureId: d.id as string, boardingPointId: b.id as string };
    };
    const reservar = (
      s: { departureId: string; boardingPointId: string },
      categorias: SolicitudReserva["passengers"][number]["fareCategory"][] = ["adulto"],
    ) =>
      bookings.create({
        ...s,
        buyerName: "Ana",
        buyerPhone: "5555555555",
        buyerEmail: "ana@example.com",
        passengers: categorias.map((fareCategory, i) => ({ fullName: `P${i}`, fareCategory })),
      });
    const estadoDe = async (id: string) => {
      const [fila] = await sql`select capacity, adult_price_cents, starts_at, status
      from departures where id = ${id}`;
      return fila as {
        capacity: number;
        adult_price_cents: number;
        starts_at: Date;
        status: string;
      };
    };

    test("plazas = capacidad − retenidos: cuentan pendiente vigente y en_revision, no vencida ni cancelada", async () => {
      const s = await nuevaSalida(10);
      expect(await departures.availableSeats(s.departureId)).toBe(10);
      const a = await reservar(s, ["adulto", "infante"]); // 2, vigente
      const b = await reservar(s, ["adulto"]); // 1 → en_revision
      const c = await reservar(s, ["adulto", "adulto"]); // 2 → vencida sin materializar
      const d = await reservar(s, ["menor"]); // 1 → cancelada
      expect(await departures.availableSeats(s.departureId)).toBe(4);
      await sql`update bookings set status = 'en_revision', expires_at = now() - interval '1 day'
      where id = ${b.booking.id}`;
      await sql`update bookings set expires_at = now() - interval '1 minute' where id = ${c.booking.id}`;
      await sql`update bookings set status = 'cancelada' where id = ${d.booking.id}`;
      expect(await departures.availableSeats(s.departureId)).toBe(10 - 2 - 1);
      expect(a.booking.status).toBe("pendiente");
    });

    test("con reservas activas: fechas 409, tarifas libres, capacidad >= retenidos, cancelar 409", async () => {
      const s = await nuevaSalida(10);
      const { booking } = await reservar(s, ["adulto", "adulto", "infante"]); // 3 retenidos

      await expect(
        departures.edit(s.departureId, { startsAt: new Date("2099-01-11T10:00:00Z") }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(departures.cancel(s.departureId)).rejects.toBeInstanceOf(ConflictError);
      await expect(departures.edit(s.departureId, { capacity: 2 })).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
      expect(await estadoDe(s.departureId)).toMatchObject({ capacity: 10, status: "publicada" });

      await departures.edit(s.departureId, { adultPriceCents: 1 });
      await departures.edit(s.departureId, { capacity: 3 });
      expect(await estadoDe(s.departureId)).toMatchObject({ capacity: 3, adult_price_cents: 1 });
      // Con la capacidad igual a lo retenido ya no caben más.
      await expect(reservar(s)).rejects.toMatchObject({ code: "capacity_exceeded" });

      // Una reserva vencida (sin materializar) ya no bloquea fechas ni cancelación.
      await sql`update bookings set expires_at = now() - interval '1 minute' where id = ${booking.id}`;
      await departures.edit(s.departureId, { startsAt: new Date("2099-01-11T10:00:00Z") });
      expect((await departures.cancel(s.departureId)).status).toBe("cancelada");
    });

    test("sin reservas todo sigue como en H2", async () => {
      const s = await nuevaSalida(5);
      await departures.edit(s.departureId, {
        startsAt: new Date("2099-01-11T10:00:00Z"),
        capacity: 0,
      });
      expect((await departures.cancel(s.departureId)).status).toBe("cancelada");
    });

    test("edición de capacidad concurrente con reservas: nunca queda capacidad < retenidos", async () => {
      for (let ronda = 0; ronda < 8; ronda++) {
        const s = await nuevaSalida(10);
        const resultados = await Promise.allSettled([
          ...Array.from({ length: 8 }, () => reservar(s)),
          departures.edit(s.departureId, { capacity: 4 }),
          departures.edit(s.departureId, { capacity: 5 }),
        ]);
        for (const r of resultados) {
          if (r.status === "rejected") {
            expect([ConflictError, BusinessRuleError].some((e) => r.reason instanceof e)).toBe(
              true,
            );
          }
        }
        const [fila] = await sql`select d.capacity,
        (select count(*)::int from booking_passengers p join bookings b on b.id = p.booking_id
           where b.departure_id = d.id) as retenidos
        from departures d where d.id = ${s.departureId}`;
        expect(fila.retenidos).toBeLessThanOrEqual(fila.capacity);
      }
    });
  },
);
