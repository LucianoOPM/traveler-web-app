import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";
import { sembrarAsignacionDe, sembrarCuenta, sembrarReservaConToken } from "../support/cuentas";

// Alertas «sin cuenta elegible» en `/admin/cuentas` con la app REAL (build de producción) y sesión
// de administrador. Construye `dist/`: no ejecutar a la vez que otras pruebas que construyan.
const ADMIN = "admin-alertas@example.test";
const OPERADOR = "operador-alertas@example.test";
const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};

async function iniciarSesion(correo: string): Promise<string> {
  const respuesta = await fetch(`${origen}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGEN },
    body: JSON.stringify({ email: correo, password: CONTRASENA }),
  });
  expect(respuesta.status, `login de ${correo}`).toBe(200);
  return respuesta.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.includes("session_token"))!;
}

describe.skipIf(!base && !process.env.CI)("alertas administrativas en /admin/cuentas", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  let admin = "";
  let operador = "";
  beforeAll(async () => {
    const app = await prepararAplicacion(sql, db, [
      { correo: ADMIN, rol: "admin" },
      { correo: OPERADOR, rol: "operator" },
    ]);
    origen = app.origen;
    detener = async () => void (await app.detener());
    admin = await iniciarSesion(ADMIN);
    operador = await iniciarSesion(OPERADOR);
  }, 180_000);
  afterAll(async () => {
    await detener();
    await sql.close();
  });

  const ver = (cookie?: string) =>
    fetch(`${origen}/admin/cuentas`, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
  const escrituras = async () => {
    const [f] = await sql`select
      (select count(*) from bank_allocations)::int as a, (select count(*) from booking_events)::int as e,
      (select count(*) from audit_events)::int as u, (select count(*) from admin_cases)::int as c,
      (select count(*) from bookings where status = 'expirada')::int as x`;
    return JSON.stringify(f);
  };
  const abrirCaso = (bookingId: string) =>
    sql`insert into admin_cases (booking_id, type) values (${bookingId}, 'sin_cuenta_elegible')`;

  test("sin alertas no aparece la sección", async () => {
    const html = await (await ver(admin)).text();
    expect(html).not.toContain("Reservas sin cuenta elegible");
  });

  test("distingue «Requiere cuenta» de «Pendiente de cierre administrativo»", async () => {
    const cuenta = await sembrarCuenta(sql);
    const requiere = await sembrarReservaConToken(sql, { monto: 120000 });
    await abrirCaso(requiere.id);
    // Ya recibió cuenta después: el caso sigue abierto, a la espera de cierre administrativo.
    const atendida = await sembrarReservaConToken(sql, { monto: 130000 });
    await sembrarAsignacionDe(sql, atendida.id, cuenta, 130000);
    await abrirCaso(atendida.id);
    // Una reserva cancelada con el caso abierto tampoco requiere cuenta.
    const cancelada = await sembrarReservaConToken(sql, { monto: 140000, estado: "cancelada" });
    await abrirCaso(cancelada.id);

    const antes = await escrituras();
    const respuesta = await ver(admin);
    const html = await respuesta.text();

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("Reservas sin cuenta elegible");
    const fila = (referencia: string) =>
      new RegExp(`<tr>(?:(?!</tr>)[\\s\\S])*${referencia}(?:(?!</tr>)[\\s\\S])*</tr>`).exec(
        html,
      )?.[0] ?? "";
    const [r1, r2, r3] = await Promise.all(
      [requiere, atendida, cancelada].map(async (r) => {
        const [{ reference }] = await sql`select reference from bookings where id = ${r.id}`;
        return fila(reference);
      }),
    );
    expect(r1).toContain("Requiere cuenta");
    expect(r1).toContain(`/admin/catalogo/salidas/${requiere.departureId}/reservas`);
    expect(r1).toContain("1,200.00");
    expect(r2).toContain("Pendiente de cierre administrativo");
    expect(r3).toContain("Pendiente de cierre administrativo");
    // La lectura no crea asignaciones, no materializa expiraciones ni cierra casos.
    expect(await escrituras()).toBe(antes);
    expect(await sql`select id from admin_cases where status = 'resuelto'`).toHaveLength(0);
  });

  test("el operador recibe 403 y sin sesión se redirige al login, sin escrituras", async () => {
    const antes = await escrituras();
    const comoOperador = await ver(operador);
    expect(comoOperador.status).toBe(403);
    expect(await comoOperador.text()).not.toContain("Reservas sin cuenta elegible");
    const anonimo = await ver();
    expect(anonimo.status).toBe(302);
    expect(anonimo.headers.get("location")).toBe("/login");
    expect(await escrituras()).toBe(antes);
  });
});
