import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { prepararAplicacion } from "../support/aplicacion";
import { cuerpoReserva, reservar, sembrarSalida } from "../support/reservas";

// Límite de solicitudes de `bookings.create` con la app REAL y su propio proceso: el contador es
// memoria del proceso, así que este archivo no puede compartirlo con `reservas-checkout.test.ts`.

const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};

describe.skipIf(!base && !process.env.CI)("límite de solicitudes del checkout", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    const app = await prepararAplicacion(sql, db, []);
    origen = app.origen;
    detener = async () => void (await app.detener());
  });
  afterAll(() => detener());

  test("5 solicitudes con forma válida por hora; la sexta da 429 y no crea reservas", async () => {
    const s = await sembrarSalida(sql, { capacity: 20 });
    // Las rechazadas por forma no cuentan.
    for (let i = 0; i < 3; i++) {
      expect((await reservar(origen, cuerpoReserva(s, { buyerEmail: "no-correo" }))).status).toBe(
        400,
      );
    }
    // Cuenta toda solicitud con forma válida, cree o no la reserva: 4 reservas y 1 que falla por regla.
    for (let i = 0; i < 4; i++) expect((await reservar(origen, cuerpoReserva(s))).status).toBe(200);
    const ajeno = await sembrarSalida(sql, { capacity: 20 });
    expect(
      (await reservar(origen, cuerpoReserva({ ...s, boardingPointId: ajeno.boardingPointId })))
        .status,
    ).toBe(422);

    const [{ n: antes }] = await sql`select count(*)::int as n from bookings`;
    expect(antes).toBe(4);

    const r = await reservar(origen, cuerpoReserva(s));
    expect(r.status).toBe(429);
    expect(JSON.parse(r.texto)).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(r.texto).not.toContain("TT-");
    const [{ n: despues }] = await sql`select count(*)::int as n from bookings`;
    expect(despues).toBe(4);

    // Sigue bloqueada, incluso con datos distintos; la validación de forma se evalúa antes.
    expect((await reservar(origen, cuerpoReserva(s))).status).toBe(429);
    expect((await reservar(origen, cuerpoReserva(s, { buyerEmail: "no-correo" }))).status).toBe(
      400,
    );
  });

  test("el límite no se evade con X-Forwarded-For", async () => {
    const s = await sembrarSalida(sql, { capacity: 20 });
    const respuesta = await fetch(`${origen}/_actions/bookings.create`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
      body: JSON.stringify(cuerpoReserva(s)),
    });
    expect(respuesta.status).toBe(429);
  });
});
