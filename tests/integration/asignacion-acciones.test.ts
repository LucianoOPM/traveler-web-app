import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generarToken } from "@modules/bookings/domain/access-token";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { prepararAplicacion } from "../support/aplicacion";
import { CLABE, sembrarCuenta, sembrarReservaConToken } from "../support/cuentas";
import { pagina } from "../support/reservas";

// Action pública `payments.requestInstructions` y página de consulta con la app REAL (build de
// producción), sin sesión. Construye `dist/`: no ejecutar junto a otras pruebas que construyan.
// El límite (20 por hora por IP, en memoria del proceso) se agota al final de este archivo.
const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};

describe.skipIf(!base && !process.env.CI)("instrucciones SPEI: Action pública y página", () => {
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

  const pedir = async (cuerpo: unknown) => {
    const r = await fetch(`${origen}/_actions/payments.requestInstructions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    return { status: r.status, texto: await r.text() };
  };
  const escrituras = async () => {
    const [f] = await sql`select
      (select count(*) from bank_allocations)::int as a, (select count(*) from booking_events)::int as e,
      (select count(*) from audit_events)::int as u, (select count(*) from admin_cases)::int as c,
      (select count(*) from bookings where status = 'expirada')::int as x`;
    return JSON.stringify(f);
  };

  let token = "";

  test("sin sesión, con el token de la reserva: devuelve las instrucciones y es idempotente", async () => {
    await sembrarCuenta(sql);
    const r = await sembrarReservaConToken(sql, { monto: 150000 });
    token = r.token;

    const uno = await pedir({ token });
    expect(uno.status).toBe(200);
    expect(uno.texto).toContain(CLABE);
    expect(uno.texto).toContain("Banco Ficticio");
    const dos = await pedir({ token });
    // `jsonb` reordena las claves del snapshot: se comparan los valores, no el orden.
    const valores = (t: string) => (JSON.parse(t) as unknown[]).slice(2).map(String).sort();
    expect(dos.status).toBe(200);
    expect(valores(dos.texto)).toEqual(valores(uno.texto));
    expect(await sql`select id from bank_allocations where booking_id = ${r.id}`).toHaveLength(1);
  });

  test("rechaza claves desconocidas (role, database, demoMode) y entradas sin forma", async () => {
    for (const extra of [{ role: "admin" }, { database: "traveltech_demo" }, { demoMode: true }]) {
      expect((await pedir({ token, ...extra })).status).toBe(400);
    }
    expect((await pedir({})).status).toBe(400);
    expect((await pedir({ token: 42 })).status).toBe(400);
  });

  test("token inexistente, mal formado o regenerado: el mismo 404, sin revelar nada", async () => {
    const respuestas = await Promise.all(
      [generarToken(), "corto", "x".repeat(43)].map((t) => pedir({ token: t })),
    );
    for (const r of respuestas) expect(r.status).toBe(404);
    expect(new Set(respuestas.map((r) => r.texto)).size).toBe(1);
  });

  test("estados que no admiten instrucciones: 409 y sin asignación", async () => {
    for (const estado of ["cancelada", "expirada", "pagada"]) {
      const r = await sembrarReservaConToken(sql, { monto: 1000, estado });
      expect((await pedir({ token: r.token })).status).toBe(409);
      expect(await sql`select id from bank_allocations where booking_id = ${r.id}`).toHaveLength(0);
    }
  });

  test("GET /reservas/<token> muestra las instrucciones, no cachea y no escribe nada", async () => {
    const antes = await escrituras();
    const r = await pagina(origen, `/reservas/${token}`);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).toContain(CLABE);
    expect(html).toContain("Instrucciones de pago SPEI");
    expect(html).not.toContain("Pedir instrucciones SPEI");

    // Una reserva sin asignación (pendiente) ofrece el botón; una cancelada no ofrece nada, y
    // ninguna de las lecturas crea asignaciones, materializa expiraciones ni abre alertas.
    const sin = await sembrarReservaConToken(sql, { monto: 1000 });
    const vencida = await sembrarReservaConToken(sql, {
      monto: 1000,
      expiraEn: new Date(Date.now() - 60_000),
    });
    const cancelada = await sembrarReservaConToken(sql, { monto: 1000, estado: "cancelada" });
    const antesLecturas = await escrituras();
    const htmlSin = await (await pagina(origen, `/reservas/${sin.token}`)).text();
    expect(htmlSin).toContain("Pedir instrucciones SPEI");
    expect(htmlSin).not.toContain(CLABE);
    for (const otra of [vencida, cancelada]) {
      const h = await (await pagina(origen, `/reservas/${otra.token}`)).text();
      expect(h).not.toContain("Pedir instrucciones SPEI");
      expect(h).not.toContain(CLABE);
    }
    expect(await escrituras()).toBe(antesLecturas);
    expect(antes).toBeTruthy();
  });

  test("sin cuenta elegible: 409 controlado y una alerta", async () => {
    await sql`update bank_accounts set is_eligible = false`;
    const r = await sembrarReservaConToken(sql, { monto: 1000 });
    const res = await pedir({ token: r.token });
    expect(res.status).toBe(409);
    expect(res.texto).not.toContain(CLABE);
    await pedir({ token: r.token });
    expect(await sql`select id from admin_cases where booking_id = ${r.id}`).toHaveLength(1);
  });

  test("el límite por IP responde 429 y no filtra información", async () => {
    let limitado = 0;
    for (let i = 0; i < 25 && !limitado; i++) {
      const r = await pedir({ token: generarToken() });
      if (r.status === 429) limitado = i;
      else expect(r.status).toBe(404);
    }
    expect(limitado).toBeGreaterThan(0);
  });
});
