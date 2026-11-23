import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { crearReservas } from "@modules/bookings/container";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";
import { pagina, sembrarSalida, tokenDe } from "../support/reservas";

// Acciones de administrador sobre reservas y su pantalla, con la app REAL (build de producción) y
// peticiones directas a `/_actions/…`. Construye `dist/`: no ejecutar junto a otras pruebas que
// construyan. Solo 2 inicios de sesión (el límite de Better Auth es 3 por 10 s).

const ADMIN = "admin-reservas@example.test";
const OPERADOR = "operador-reservas@example.test";
const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};
const cookies: Record<string, string> = {};

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

const llamar = async (accion: string, cuerpo: unknown, cookie?: string) => {
  const respuesta = await fetch(`${origen}/_actions/bookings.${accion}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, texto };
};

describe.skipIf(!base && !process.env.CI)("acciones de administrador sobre reservas", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  let adminId = "";
  const { bookings } = crearReservas(db);

  beforeAll(async () => {
    const app = await prepararAplicacion(sql, db, [
      { correo: ADMIN, rol: "admin" },
      { correo: OPERADOR, rol: "operator" },
    ]);
    origen = app.origen;
    detener = async () => void (await app.detener());
    cookies.admin = await iniciarSesion(ADMIN);
    cookies.operador = await iniciarSesion(OPERADOR);
    const [u] = await sql`select id from "user" where email = ${ADMIN}`;
    adminId = u.id;
  }, 180_000);
  afterAll(async () => {
    await detener();
  });

  const nueva = async (capacity = 5) => {
    const s = await sembrarSalida(sql, { capacity });
    const { booking, token } = await bookings.create({
      ...s,
      buyerName: "Ana Pérez",
      buyerPhone: "5551234567",
      buyerEmail: "ana@example.com",
      passengers: [{ fullName: "Ana Pérez", fareCategory: "adulto" }],
    });
    return { ...s, id: booking.id, token };
  };
  const motivo = { reason: "motivo de prueba" };
  const estado = async (id: string) => {
    const [f] = await sql`select status from bookings where id = ${id}`;
    return f.status as string;
  };
  const eventos = async (id: string) =>
    (await sql`select type, actor_type, actor_user_id, reason from booking_events
      where booking_id = ${id} order by created_at, type`) as {
      type: string;
      actor_type: string;
      actor_user_id: string | null;
      reason: string | null;
    }[];

  test("sin sesión 401 y operador 403 en las tres Actions, sin cambiar nada", async () => {
    const r = await nueva();
    for (const accion of ["cancel", "reactivate", "regenerateToken"]) {
      const cuerpo = { bookingId: r.id, ...motivo };
      expect((await llamar(accion, cuerpo)).status, `${accion} sin sesión`).toBe(401);
      expect((await llamar(accion, cuerpo, cookies.operador)).status, `${accion} operador`).toBe(
        403,
      );
    }
    expect(await estado(r.id)).toBe("pendiente");
    expect((await eventos(r.id)).map((e) => e.type)).toEqual(["creada"]);
  });

  test("admin: cancelar (idempotente), reactivar (idempotente) y el actor sale de la sesión", async () => {
    const r = await nueva();
    expect((await llamar("cancel", { bookingId: r.id, ...motivo }, cookies.admin)).status).toBe(
      200,
    );
    expect((await llamar("cancel", { bookingId: r.id, ...motivo }, cookies.admin)).status).toBe(
      200,
    );
    expect(await estado(r.id)).toBe("cancelada");
    expect((await llamar("reactivate", { bookingId: r.id, ...motivo }, cookies.admin)).status).toBe(
      200,
    );
    const [antes] = await sql`select expires_at from bookings where id = ${r.id}`;
    expect((await llamar("reactivate", { bookingId: r.id, ...motivo }, cookies.admin)).status).toBe(
      200,
    );
    const [despues] = await sql`select expires_at from bookings where id = ${r.id}`;
    expect(despues.expires_at).toEqual(antes.expires_at);
    expect(await estado(r.id)).toBe("pendiente");

    const evs = await eventos(r.id);
    expect(evs.map((e) => e.type)).toEqual(["creada", "cancelada", "reactivada"]);
    for (const e of evs.slice(1)) {
      expect(e).toMatchObject({
        actor_type: "admin",
        actor_user_id: adminId,
        reason: "motivo de prueba",
      });
    }
  });

  test("regenerar: devuelve el token una vez, el enlace anterior da 404 al instante y el nuevo funciona", async () => {
    const r = await nueva();
    expect((await pagina(origen, `/reservas/${r.token}`)).status).toBe(200);
    const respuesta = await llamar(
      "regenerateToken",
      { bookingId: r.id, ...motivo },
      cookies.admin,
    );
    expect(respuesta.status).toBe(200);
    const nuevo = tokenDe(respuesta.texto);
    expect(nuevo).not.toBe(r.token);
    expect((await pagina(origen, `/reservas/${r.token}`)).status).toBe(404);
    expect((await pagina(origen, `/reservas/${nuevo}`)).status).toBe(200);
    const evs = await eventos(r.id);
    expect(evs.at(-1)).toMatchObject({ type: "token_regenerado", actor_user_id: adminId });
    const [{ volcado }] = await sql`select string_agg(to_jsonb(e)::text, '') as volcado
      from booking_events e where booking_id = ${r.id}`;
    expect(volcado).not.toContain(nuevo);
    expect(volcado).not.toContain(r.token);
  });

  test("entrada inválida: motivo vacío o de espacios, claves extra y ids malos dan 400 sin cambios", async () => {
    const r = await nueva();
    const malos = [
      { bookingId: r.id, reason: "" },
      { bookingId: r.id, reason: "     " },
      { bookingId: r.id, reason: "x".repeat(501) },
      { bookingId: r.id },
      { bookingId: "no-es-uuid", ...motivo },
      { bookingId: r.id, ...motivo, actorUserId: adminId }, // el actor jamás viene del cliente
      { bookingId: r.id, ...motivo, role: "admin" },
    ];
    for (const cuerpo of malos) {
      for (const accion of ["cancel", "reactivate", "regenerateToken"]) {
        const x = await llamar(accion, cuerpo, cookies.admin);
        expect(x.status, `${accion} ${JSON.stringify(Object.keys(cuerpo))}`).toBe(400);
      }
    }
    expect(await estado(r.id)).toBe("pendiente");
    expect((await eventos(r.id)).map((e) => e.type)).toEqual(["creada"]);
    expect(
      (
        await llamar(
          "cancel",
          { bookingId: "5f1c1c0e-0000-4000-8000-0000000000ff", ...motivo },
          cookies.admin,
        )
      ).status,
    ).toBe(404);
  });

  test("transiciones incompatibles dan 409: cancelar una expirada, regenerar una cancelada", async () => {
    const r = await nueva();
    await sql`update bookings set expires_at = now() - interval '1 minute' where id = ${r.id}`;
    expect((await llamar("cancel", { bookingId: r.id, ...motivo }, cookies.admin)).status).toBe(
      409,
    );
    expect(
      (await llamar("regenerateToken", { bookingId: r.id, ...motivo }, cookies.admin)).status,
    ).toBe(409);
    // La expiración materializada persiste aunque la operación fuera rechazada.
    expect(await estado(r.id)).toBe("expirada");
    expect((await eventos(r.id)).map((e) => e.type)).toEqual(["creada", "expirada"]);

    const c = await nueva();
    await llamar("cancel", { bookingId: c.id, ...motivo }, cookies.admin);
    expect(
      (await llamar("regenerateToken", { bookingId: c.id, ...motivo }, cookies.admin)).status,
    ).toBe(409);
  });

  test("reactivar sin capacidad da 409 y la reserva sigue como estaba", async () => {
    const s = await sembrarSalida(sql, { capacity: 1 });
    const crear = () =>
      bookings.create({
        ...s,
        buyerName: "Ana",
        buyerPhone: "1",
        buyerEmail: "ana@example.com",
        passengers: [{ fullName: "Ana", fareCategory: "adulto" }],
      });
    const { booking: primera } = await crear();
    await llamar("cancel", { bookingId: primera.id, ...motivo }, cookies.admin);
    await crear(); // ocupa el único lugar
    const x = await llamar("reactivate", { bookingId: primera.id, ...motivo }, cookies.admin);
    expect(x.status).toBe(409);
    expect(await estado(primera.id)).toBe("cancelada");
  });

  test("pantalla de reservas: sin sesión redirige, operador 403 sin datos, admin ve contacto y acciones", async () => {
    const r = await nueva();
    const ruta = `/admin/catalogo/salidas/${r.departureId}/reservas`;
    const sin = await pagina(origen, ruta);
    expect(sin.status).toBe(302);
    expect(sin.headers.get("location")).toBe("/login");

    const operador = await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.operador! } });
    expect(operador.status).toBe(403);
    const cuerpoOperador = await operador.text();
    expect(cuerpoOperador).not.toContain("5551234567");
    expect(cuerpoOperador).not.toContain("ana@example.com");

    const admin = await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.admin! } });
    expect(admin.status).toBe(200);
    expect(admin.headers.get("cache-control")).toBe("no-store");
    const html = await admin.text();
    for (const texto of [
      "Ana Pérez",
      "5551234567",
      "ana@example.com",
      "Cancelar reserva",
      "Regenerar enlace",
      "Motivo",
    ]) {
      expect(html, texto).toContain(texto);
    }
    expect(html).not.toContain(r.token); // el token en claro no existe en ninguna pantalla

    for (const mala of [
      "/admin/catalogo/salidas/no-es-uuid/reservas",
      "/admin/catalogo/salidas/5f1c1c0e-0000-4000-8000-0000000000ff/reservas",
    ]) {
      expect(
        (await fetch(`${origen}${mala}`, { headers: { cookie: cookies.admin! } })).status,
      ).toBe(404);
    }
  });

  test("ningún GET escribe: la pantalla y la consulta de una pendiente vencida no la materializan", async () => {
    const r = await nueva();
    await sql`update bookings set expires_at = now() - interval '1 minute' where id = ${r.id}`;
    const antes = await sql`select status, expires_at, updated_at from bookings where id = ${r.id}`;
    const [{ n: eventosAntes }] = await sql`select count(*)::int as n from booking_events`;
    const ruta = `/admin/catalogo/salidas/${r.departureId}/reservas`;
    const html = await (
      await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.admin! } })
    ).text();
    expect(html).toContain("Expirada");
    expect(html).toContain("Reactivar reserva");
    await pagina(origen, `/reservas/${r.token}`);
    expect(
      await sql`select status, expires_at, updated_at from bookings where id = ${r.id}`,
    ).toEqual(antes);
    const [{ n: eventosDespues }] = await sql`select count(*)::int as n from booking_events`;
    expect(eventosDespues).toBe(eventosAntes);
    expect(await estado(r.id)).toBe("pendiente");
  });
});
