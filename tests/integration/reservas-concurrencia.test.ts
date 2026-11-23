import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import * as esquema from "@db/schema";
import { BusinessRuleError, ConflictError } from "@lib/errors";
import { hashDeToken } from "@modules/bookings/domain/access-token";
import { crearReservas } from "@modules/bookings/container";
import { crearCatalogo } from "@modules/catalog/container";
import { departures as tablaSalidas } from "@modules/catalog/schema";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

// Concurrencia REAL sobre PostgreSQL: cada contendiente usa su PROPIA conexión (un `SQL` por
// cliente), no un pool compartido. Las pruebas deterministas toman el `FOR UPDATE` de la salida con
// una «compuerta», lanzan las operaciones, esperan (con `pg_stat_activity`) a que de verdad estén
// bloqueadas por ese bloqueo, y solo entonces la liberan: así se ejercita la contención sin `sleep`.
// Las rondas repetidas (10) añaden órdenes de llegada distintos y comprueban invariantes.
const RONDAS = 10;
const ESPERA_MAX_MS = 10_000;
const TIEMPO_PRUEBA = 60_000;
// Conexiones por cliente: pocas, para no agotar `max_connections` de PostgreSQL (100) con ~8 clientes.
const CONEXIONES_POR_CLIENTE = 2;

describe.skipIf(!base && !process.env.CI)(
  "concurrencia de reservas con conexiones independientes",
  () => {
    const { sql, db } = base ?? {};
    if (!sql || !db) {
      test("TEST_DATABASE_URL es obligatoria en CI", () => {
        throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
      });
      return;
    }

    const abiertos: SQL[] = [];
    let admin = "";
    let contador = 0;

    /** Abre una conexión propia (no compartida). Todas se cierran en `afterAll` aunque algo falle. */
    const abrirPropia = () => {
      const cliente = new SQL({ url: process.env.TEST_DATABASE_URL!, max: CONEXIONES_POR_CLIENTE });
      abiertos.push(cliente);
      return { sql: cliente, db: drizzle({ client: cliente, schema: esquema }) };
    };
    /** Un cliente = su propia conexión con sus servicios. */
    const cliente = () => {
      const c = abrirPropia();
      return { db: c.db, ...crearReservas(c.db), ...crearCatalogo(c.db) };
    };
    const clientes = Array.from({ length: 8 }, cliente);
    const c = (i: number) => clientes[i]!;

    beforeAll(async () => {
      await recrearEsquema(sql);
      await migrate(db, { migrationsFolder: "./src/db/migrations" });
      const [u] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Admin', 'admin-concurrencia@example.test', now(), now()) returning id`;
      admin = u.id;
    });
    afterAll(async () => {
      await Promise.allSettled(abiertos.map((s) => s.close()));
      await sql.close();
    });

    const MOTIVO = () => ({ actorUserId: admin, reason: "motivo de prueba" });
    type Salida = { departureId: string; boardingPointId: string };

    const nuevaSalida = async (capacity: number): Promise<Salida> => {
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
    const reservar = (cl: ReturnType<typeof cliente>, s: Salida, pasajeros = 1) =>
      cl.bookings.create({
        ...s,
        buyerName: "Ana",
        buyerPhone: "5555555555",
        buyerEmail: "ana@example.com",
        passengers: Array.from({ length: pasajeros }, (_, i) => ({
          fullName: `P${i}`,
          fareCategory: "adulto" as const,
        })),
      });
    const vencer = (id: string) =>
      sql`update bookings set expires_at = now() - interval '1 minute' where id = ${id}`;

    // Pasajeros que ocupan lugar según la regla única (pendiente vigente o en_revision).
    const retenidos = async (departureId: string) => {
      const [f] = await sql`select coalesce(sum(n), 0)::int as total from (
      select count(p.id) as n from bookings b join booking_passengers p on p.booking_id = b.id
      where b.departure_id = ${departureId}
        and (b.status = 'en_revision' or (b.status = 'pendiente' and b.expires_at > now()))
      group by b.id) t`;
      return f.total as number;
    };
    const eventos = async (bookingId: string, tipo: string) => {
      const [f] = await sql`select count(*)::int as n from booking_events
      where booking_id = ${bookingId} and type = ${tipo}`;
      return f.n as number;
    };
    const salidaEn = async (departureId: string) => {
      const [f] = await sql`select capacity, status, adult_price_cents from departures
      where id = ${departureId}`;
      return f as { capacity: number; status: string; adult_price_cents: number };
    };
    const reservasDe = async (departureId: string) => {
      const [f] =
        await sql`select count(*)::int as n from bookings where departure_id = ${departureId}`;
      return f.n as number;
    };

    const conTiempo = <T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> => {
      let temporizador: ReturnType<typeof setTimeout>;
      const limite = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms);
      });
      return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
    };

    /** Espera a que haya al menos `n` sesiones esperando un bloqueo de fila (con tiempo máximo). */
    const esperarBloqueados = async (n: number) => {
      const fin = Date.now() + ESPERA_MAX_MS;
      while (Date.now() < fin) {
        const [f] = await sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and state = 'active' and wait_event_type = 'Lock'`;
        if (f.n >= n) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`Se esperaban ${n} sesiones bloqueadas y no llegaron en ${ESPERA_MAX_MS} ms`);
    };

    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

    /**
     * Compuerta: una conexión propia toma `SELECT … FOR UPDATE` sobre la salida y la mantiene hasta
     * `soltar()`. Si se pasa `cambio`, se aplica dentro de esa transacción justo antes del commit.
     */
    const compuerta = async (departureId: string, cambio?: (tx: Tx) => Promise<void>) => {
      const propia = abrirPropia();
      let abrirPuerta!: () => void;
      const puerta = new Promise<void>((r) => (abrirPuerta = r));
      let tomada!: () => void;
      let fallo!: (e: unknown) => void;
      const lista = new Promise<void>((resolve, reject) => {
        tomada = resolve;
        fallo = reject;
      });
      const terminada = propia.db
        .transaction(async (tx) => {
          await tx
            .select({ id: tablaSalidas.id })
            .from(tablaSalidas)
            .where(eq(tablaSalidas.id, departureId))
            .for("update");
          tomada();
          await puerta;
          await cambio?.(tx);
        })
        .catch((e) => {
          fallo(e);
          throw e;
        });
      terminada.catch(() => {}); // evita un rechazo sin atender si `soltar` no llega a llamarse
      await conTiempo(lista, ESPERA_MAX_MS, "La compuerta no obtuvo el bloqueo");
      return {
        soltar: async () => {
          abrirPuerta();
          await conTiempo(terminada, ESPERA_MAX_MS, "La compuerta no confirmó");
          await propia.sql.close(); // la compuerta no deja su conexión abierta
        },
      };
    };

    /**
     * Lanza las operaciones con la salida bloqueada por la compuerta, espera a que TODAS estén
     * esperando ese bloqueo y la libera. Devuelve el resultado de cada una.
     */
    const conCompuerta = async (
      departureId: string,
      lanzar: () => Promise<unknown>[],
      cambio?: (tx: Tx) => Promise<void>,
    ) => {
      const g = await compuerta(departureId, cambio);
      let resultados!: Promise<PromiseSettledResult<unknown>[]>;
      try {
        const operaciones = lanzar();
        resultados = Promise.allSettled(operaciones); // atiende los rechazos desde el principio
        await esperarBloqueados(operaciones.length);
      } finally {
        await g.soltar();
      }
      return conTiempo(
        resultados,
        ESPERA_MAX_MS,
        "Las operaciones no terminaron tras liberar el bloqueo",
      );
    };
    const cumplidas = (r: PromiseSettledResult<unknown>[]) =>
      r.filter((x) => x.status === "fulfilled");
    const rechazadas = (r: PromiseSettledResult<unknown>[]) =>
      r.filter((x): x is PromiseRejectedResult => x.status === "rejected");

    // 1. Últimos lugares ---------------------------------------------------------------------------

    test(
      "últimos lugares: con la salida bloqueada, 6 conexiones piden y solo se aceptan las 2 que caben",
      async () => {
        const s = await nuevaSalida(3);
        await reservar(c(7), s); // 1 retenido: quedan 2
        const r = await conCompuerta(s.departureId, () =>
          [0, 1, 2, 3, 4, 5].map((i) => reservar(c(i), s)),
        );
        expect(cumplidas(r)).toHaveLength(2);
        const no = rechazadas(r);
        expect(no).toHaveLength(4);
        for (const x of no) {
          expect(x.reason).toBeInstanceOf(ConflictError);
          expect(x.reason.code).toBe("capacity_exceeded");
        }
        expect(await retenidos(s.departureId)).toBe(3);
      },
      TIEMPO_PRUEBA,
    );

    test(
      `últimos lugares, ${RONDAS} rondas con 8 conexiones sin compuerta: se aceptan exactamente las que caben`,
      async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const s = await nuevaSalida(4);
          const r = await Promise.allSettled(clientes.map((cl) => reservar(cl, s)));
          expect(cumplidas(r), `ronda ${ronda}`).toHaveLength(4);
          for (const x of rechazadas(r)) expect(x.reason).toBeInstanceOf(ConflictError);
          expect(await retenidos(s.departureId)).toBe(4);
        }
      },
      TIEMPO_PRUEBA,
    );

    // 2. Creación contra expiración perezosa -------------------------------------------------------

    test(
      "creación contra expiración perezosa: la vencida se materializa una sola vez y libera sus lugares",
      async () => {
        const s = await nuevaSalida(2);
        const { booking: vieja } = await reservar(c(7), s, 2);
        await vencer(vieja.id);
        const r = await conCompuerta(s.departureId, () => [0, 1, 2].map((i) => reservar(c(i), s)));
        expect(cumplidas(r)).toHaveLength(2); // los 2 lugares de la vencida quedaron libres
        expect(rechazadas(r)).toHaveLength(1);
        const [f] = await sql`select status from bookings where id = ${vieja.id}`;
        expect(f.status).toBe("expirada");
        expect(await eventos(vieja.id, "expirada")).toBe(1);
        expect(await retenidos(s.departureId)).toBe(2);
      },
      TIEMPO_PRUEBA,
    );

    // 3. Reactivación contra creación por el último lugar ------------------------------------------

    test(
      "reactivación contra creación por el último lugar: gana exactamente una y la otra recibe 409",
      async () => {
        const s = await nuevaSalida(1);
        const { booking } = await reservar(c(7), s);
        await c(7).bookings.cancel(booking.id, MOTIVO());
        const r = await conCompuerta(s.departureId, () => [
          c(0).bookings.reactivate(booking.id, MOTIVO()),
          reservar(c(1), s),
        ]);
        expect(cumplidas(r)).toHaveLength(1);
        const [perdedora] = rechazadas(r);
        expect(perdedora!.reason).toBeInstanceOf(ConflictError);
        expect(perdedora!.reason.code).toBe("capacity_exceeded");
        expect(await retenidos(s.departureId)).toBe(1);
      },
      TIEMPO_PRUEBA,
    );

    test(
      `reactivación contra creación, ${RONDAS} rondas con órdenes de llegada alternados`,
      async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const s = await nuevaSalida(1);
          const { booking } = await reservar(c(7), s);
          await c(7).bookings.cancel(booking.id, MOTIVO());
          const reactivar = () => c(0).bookings.reactivate(booking.id, MOTIVO());
          const crear = () => reservar(c(1), s);
          const r = await Promise.allSettled(
            ronda % 2 ? [reactivar(), crear()] : [crear(), reactivar()],
          );
          expect(cumplidas(r), `ronda ${ronda}`).toHaveLength(1);
          expect(await retenidos(s.departureId)).toBe(1);
        }
      },
      TIEMPO_PRUEBA,
    );

    // 4. Reserva contra edición de capacidad, y dos ediciones de capacidad -------------------------

    test(
      "reserva contra edición de capacidad: nunca queda la capacidad por debajo de lo retenido",
      async () => {
        const s = await nuevaSalida(6);
        await reservar(c(7), s, 2);
        const r = await conCompuerta(s.departureId, () => [
          reservar(c(0), s),
          reservar(c(1), s),
          reservar(c(2), s),
          c(3).departures.edit(s.departureId, { capacity: 3 }),
        ]);
        const edicion = r[3]!;
        if (edicion.status === "rejected") expect(edicion.reason).toBeInstanceOf(BusinessRuleError);
        const { capacity } = await salidaEn(s.departureId);
        const retenido = await retenidos(s.departureId);
        expect(retenido).toBeLessThanOrEqual(capacity);
        expect(retenido).toBe(2 + cumplidas(r.slice(0, 3)).length);
      },
      TIEMPO_PRUEBA,
    );

    test(
      "dos ediciones de capacidad simultáneas: las válidas se aplican y la inválida se rechaza sin escrituras parciales",
      async () => {
        const s = await nuevaSalida(10);
        await reservar(c(7), s, 3);
        const r = await conCompuerta(s.departureId, () => [
          c(0).departures.edit(s.departureId, { capacity: 3 }),
          c(1).departures.edit(s.departureId, { capacity: 5 }),
          c(2).departures.edit(s.departureId, { capacity: 2 }), // menor que lo retenido
        ]);
        expect(r[0]!.status).toBe("fulfilled");
        expect(r[1]!.status).toBe("fulfilled");
        expect(r[2]!.status).toBe("rejected");
        expect((r[2] as PromiseRejectedResult).reason).toBeInstanceOf(BusinessRuleError);
        const { capacity } = await salidaEn(s.departureId);
        expect([3, 5]).toContain(capacity); // la última edición confirmada
        expect(await retenidos(s.departureId)).toBeLessThanOrEqual(capacity);
      },
      TIEMPO_PRUEBA,
    );

    // 5. Reserva contra cambio de tarifa -----------------------------------------------------------

    test(
      "reserva contra cambio de tarifa: la reserva queda con el precio vigente al obtener el bloqueo",
      async () => {
        const s = await nuevaSalida(5);
        const r = await conCompuerta(
          s.departureId,
          () => [reservar(c(0), s)],
          async (tx) => {
            await tx
              .update(tablaSalidas)
              .set({ adultPriceCents: 200000 })
              .where(eq(tablaSalidas.id, s.departureId));
          },
        );
        expect(cumplidas(r)).toHaveLength(1);
        const [f] = await sql`select b.total_cents, p.price_snapshot_cents from bookings b
        join booking_passengers p on p.booking_id = b.id where b.departure_id = ${s.departureId}`;
        expect(f).toMatchObject({ total_cents: 200000, price_snapshot_cents: 200000 });
        // Y el precio ya congelado no cambia con ediciones posteriores.
        await c(1).departures.edit(s.departureId, { adultPriceCents: 1 });
        const [g] =
          await sql`select total_cents from bookings where departure_id = ${s.departureId}`;
        expect(g.total_cents).toBe(200000);
      },
      TIEMPO_PRUEBA,
    );

    // 6. Reserva contra cancelación de la salida ---------------------------------------------------

    test(
      "reserva contra cancelación de la salida: si la cancelación confirma primero, la reserva da 422 y no deja filas",
      async () => {
        const s = await nuevaSalida(5);
        const r = await conCompuerta(
          s.departureId,
          () => [reservar(c(0), s)],
          async (tx) => {
            await tx
              .update(tablaSalidas)
              .set({ status: "cancelada" })
              .where(eq(tablaSalidas.id, s.departureId));
          },
        );
        expect(rechazadas(r)).toHaveLength(1);
        expect(rechazadas(r)[0]!.reason).toBeInstanceOf(BusinessRuleError);
        expect(await reservasDe(s.departureId)).toBe(0);
      },
      TIEMPO_PRUEBA,
    );

    test(
      `reserva contra cancelación de la salida, ${RONDAS} rondas: nunca hay una salida cancelada con reservas activas`,
      async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const s = await nuevaSalida(5);
          const crear = () => reservar(c(0), s);
          const cancelar = () => c(1).departures.cancel(s.departureId);
          const r = await Promise.allSettled(
            ronda % 2 ? [cancelar(), crear()] : [crear(), cancelar()],
          );
          const salida = await salidaEn(s.departureId);
          const activas = await retenidos(s.departureId);
          // Gana una sola de las dos: o se cancela (sin reservas) o se reserva (y cancelar da 409).
          if (salida.status === "cancelada") {
            expect(activas, `ronda ${ronda}`).toBe(0);
          } else {
            expect(activas, `ronda ${ronda}`).toBe(1);
            const cancel = r[ronda % 2 ? 0 : 1] as PromiseRejectedResult;
            expect(cancel.status).toBe("rejected");
            expect(cancel.reason).toBeInstanceOf(ConflictError);
          }
        }
      },
      TIEMPO_PRUEBA,
    );

    // 7. Doble cancelación y doble reactivación ----------------------------------------------------

    test(
      "doble cancelación simultánea: ambas tienen éxito, un solo cambio y un solo evento",
      async () => {
        const s = await nuevaSalida(5);
        const { booking } = await reservar(c(7), s);
        const r = await conCompuerta(s.departureId, () => [
          c(0).bookings.cancel(booking.id, MOTIVO()),
          c(1).bookings.cancel(booking.id, MOTIVO()),
        ]);
        expect(cumplidas(r)).toHaveLength(2);
        const cambios = r.map(
          (x) => (x as PromiseFulfilledResult<{ cambio: boolean }>).value.cambio,
        );
        expect(cambios.filter(Boolean)).toHaveLength(1);
        expect(await eventos(booking.id, "cancelada")).toBe(1);
      },
      TIEMPO_PRUEBA,
    );

    test(
      "doble reactivación simultánea: un solo cambio, un solo evento y el vencimiento no se renueva",
      async () => {
        const s = await nuevaSalida(5);
        const { booking } = await reservar(c(7), s);
        await c(7).bookings.cancel(booking.id, MOTIVO());
        const r = await conCompuerta(s.departureId, () => [
          c(0).bookings.reactivate(booking.id, MOTIVO()),
          c(1).bookings.reactivate(booking.id, MOTIVO()),
        ]);
        expect(cumplidas(r)).toHaveLength(2);
        const valores = r.map(
          (x) => (x as PromiseFulfilledResult<{ cambio: boolean; expiresAt: Date }>).value,
        );
        expect(valores.filter((v) => v.cambio)).toHaveLength(1);
        expect(valores[0]!.expiresAt.getTime()).toBe(valores[1]!.expiresAt.getTime());
        const [f] = await sql`select expires_at from bookings where id = ${booking.id}`;
        expect(f.expires_at.getTime()).toBe(valores[0]!.expiresAt.getTime());
        expect(await eventos(booking.id, "reactivada")).toBe(1);
      },
      TIEMPO_PRUEBA,
    );

    test(
      `doble cancelación y doble reactivación, ${RONDAS} rondas sin compuerta: sin eventos duplicados`,
      async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const s = await nuevaSalida(5);
          const { booking } = await reservar(c(7), s);
          const cancelaciones = await Promise.all([
            c(0).bookings.cancel(booking.id, MOTIVO()),
            c(1).bookings.cancel(booking.id, MOTIVO()),
          ]);
          expect(
            cancelaciones.filter((x) => x.cambio),
            `ronda ${ronda}`,
          ).toHaveLength(1);
          const reactivaciones = await Promise.all([
            c(2).bookings.reactivate(booking.id, MOTIVO()),
            c(3).bookings.reactivate(booking.id, MOTIVO()),
          ]);
          expect(reactivaciones.filter((x) => x.cambio)).toHaveLength(1);
          expect(reactivaciones[0]!.expiresAt.getTime()).toBe(
            reactivaciones[1]!.expiresAt.getTime(),
          );
          expect(await eventos(booking.id, "cancelada")).toBe(1);
          expect(await eventos(booking.id, "reactivada")).toBe(1);
        }
      },
      TIEMPO_PRUEBA,
    );

    // 8. Token regenerado --------------------------------------------------------------------------

    test(
      "token regenerado: mientras la regeneración espera el bloqueo el viejo sigue válido; al confirmar deja de serlo para todos",
      async () => {
        const s = await nuevaSalida(5);
        const { booking, token: viejo } = await reservar(c(7), s);
        const g = await compuerta(s.departureId);
        let regeneracion!: Promise<{ token: string }>;
        try {
          regeneracion = c(0).bookings.regenerateToken(booking.id, MOTIVO());
          regeneracion.catch(() => {});
          await esperarBloqueados(1);
          // Sin confirmar, el enlace viejo sigue funcionando (la lectura no se bloquea).
          expect((await c(1).bookings.findByToken(viejo))?.reference).toBe(booking.reference);
        } finally {
          await g.soltar();
        }
        const { token: nuevo } = await conTiempo(
          regeneracion,
          ESPERA_MAX_MS,
          "regenerar no terminó",
        );
        // Tras confirmar, consultas concurrentes desde conexiones distintas: el viejo ya no existe.
        const viejos = await Promise.all(
          [1, 2, 3, 4, 5].map((i) => c(i).bookings.findByToken(viejo)),
        );
        expect(viejos).toEqual([null, null, null, null, null]);
        const nuevos = await Promise.all(
          [1, 2, 3, 4, 5].map((i) => c(i).bookings.findByToken(nuevo)),
        );
        for (const n of nuevos) expect(n?.reference).toBe(booking.reference);
      },
      TIEMPO_PRUEBA,
    );

    test(
      "token regenerado: un lector concurrente ve el viejo y luego nunca más (transición monótona, inmediata)",
      async () => {
        const s = await nuevaSalida(5);
        const { booking, token: viejo } = await reservar(c(7), s);
        const lecturas: boolean[] = [];
        let seguir = true;
        const lector = (async () => {
          while (seguir) lecturas.push((await c(1).bookings.findByToken(viejo)) !== null);
        })();
        while (lecturas.length < 5) await new Promise((r) => setTimeout(r, 5)); // el lector ya corre
        await c(0).bookings.regenerateToken(booking.id, MOTIVO());
        const alConfirmar = lecturas.length;
        await new Promise((r) => setTimeout(r, 50));
        seguir = false;
        await conTiempo(lector, ESPERA_MAX_MS, "el lector no terminó");
        expect(lecturas[0]).toBe(true);
        // Una vez inválido, nunca vuelve a ser válido.
        expect(lecturas.slice(lecturas.indexOf(false))).not.toContain(true);
        // Las lecturas que EMPIEZAN después de que regenerar resolvió ya ven el viejo inválido.
        expect(lecturas.slice(alConfirmar + 1)).not.toContain(true);
        expect(lecturas.slice(alConfirmar + 1).length).toBeGreaterThan(0);
      },
      TIEMPO_PRUEBA,
    );

    test(
      "dos regeneraciones simultáneas: solo el último token confirmado queda válido",
      async () => {
        const s = await nuevaSalida(5);
        const { booking, token: original } = await reservar(c(7), s);
        const orden: number[] = [];
        const r = await conCompuerta(s.departureId, () =>
          [0, 1].map((i) =>
            c(i)
              .bookings.regenerateToken(booking.id, MOTIVO())
              .then((x) => (orden.push(i), x)),
          ),
        );
        expect(cumplidas(r)).toHaveLength(2);
        const tokens = r.map((x) => (x as PromiseFulfilledResult<{ token: string }>).value.token);
        const ultimo = tokens[orden.at(-1)!]!;
        const anterior = tokens[orden[0]!]!;
        expect((await c(2).bookings.findByToken(ultimo))?.reference).toBe(booking.reference);
        expect(await c(2).bookings.findByToken(anterior)).toBeNull();
        expect(await c(2).bookings.findByToken(original)).toBeNull();
        const [f] = await sql`select access_token_hash from bookings where id = ${booking.id}`;
        expect(f.access_token_hash).toBe(hashDeToken(ultimo));
        expect(await eventos(booking.id, "token_regenerado")).toBe(2);
      },
      TIEMPO_PRUEBA,
    );
  },
);
