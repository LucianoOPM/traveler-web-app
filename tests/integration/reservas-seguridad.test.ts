import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { crearReservas } from "@modules/bookings/container";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";
import { cuerpoReserva, pagina, reservar, sembrarSalida } from "../support/reservas";

// Revisión de seguridad de las Actions de H3 con la app REAL (build de producción): permisos por
// petición directa, errores inesperados que no filtran nada y GET que no escribe datos de negocio.
// Construye `dist/`: no ejecutar junto a otras pruebas que construyan. Solo 2 inicios de sesión.
// La Action pública cuenta contra el límite de 5 por hora por IP: aquí se hacen como máximo 4.

const ADMIN = "admin-seguridad@example.test";
const OPERADOR = "operador-seguridad@example.test";
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
  return { status: respuesta.status, texto: await respuesta.text() };
};

// Tabla explícita de las Actions de H3 y lo que se espera sin sesión y con rol de operador. Una
// Action nueva de reservas debe añadirse aquí. `null` = pública (no exige sesión ni rol).
const PERMISOS: Record<string, { sinSesion: number | null; operador: number | null }> = {
  create: { sinSesion: null, operador: null },
  cancel: { sinSesion: 401, operador: 403 },
  reactivate: { sinSesion: 401, operador: 403 },
  regenerateToken: { sinSesion: 401, operador: 403 },
};

describe.skipIf(!base && !process.env.CI)("seguridad de las Actions y GET de H3", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  const { bookings } = crearReservas(db);
  let adminId = "";

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

  const nueva = async () => {
    const s = await sembrarSalida(sql, { capacity: 10 });
    const { booking, token } = await bookings.create({
      ...s,
      buyerName: "Ana Pérez",
      buyerPhone: "5551234567",
      buyerEmail: "ana@example.com",
      passengers: [{ fullName: "Ana Pérez", fareCategory: "adulto" }],
    });
    return { ...s, id: booking.id, token };
  };
  const filaDe = async (id: string) => {
    const [f] = await sql`select status, access_token_hash from bookings where id = ${id}`;
    return f as { status: string; access_token_hash: string };
  };
  const tipos = async (id: string) =>
    (
      await sql`select type from booking_events where booking_id = ${id} order by created_at, type`
    ).map((e: { type: string }) => e.type);

  test("permisos por petición directa: las de administrador dan 401 sin sesión y 403 al operador; create es pública", async () => {
    const r = await nueva();
    for (const [accion, esperado] of Object.entries(PERMISOS)) {
      // Entrada de forma válida: así Zod no responde 400 antes de llegar al permiso.
      const cuerpo =
        accion === "create"
          ? cuerpoReserva({
              departureId: "5f1c1c0e-0000-4000-8000-0000000000ff",
              boardingPointId: r.boardingPointId,
            })
          : { bookingId: r.id, reason: "motivo de prueba" };
      const sin = await llamar(accion, cuerpo);
      const operador = await llamar(accion, cuerpo, cookies.operador);
      if (esperado.sinSesion === null) {
        // Pública: no se exige sesión ni rol (la salida no existe, así que llega a la regla: 422).
        expect([sin.status, operador.status], accion).toEqual([422, 422]);
      } else {
        expect(sin.status, `${accion} sin sesión`).toBe(esperado.sinSesion);
        expect(operador.status, `${accion} operador`).toBe(esperado.operador!);
      }
    }
    // Las acciones de admin rechazadas no cambiaron nada.
    expect((await filaDe(r.id)).status).toBe("pendiente");
    expect(await tipos(r.id)).toEqual(["creada"]);
  });

  test("errores inesperados: respuesta genérica sin SQL, tablas, detalles de PostgreSQL ni datos enviados", async () => {
    const FUGAS =
      /utf8|byte|invalid|postgres|booking|insert|update|select|relation|column|sql|Secreto/i;

    // Un NUL no es texto válido en PostgreSQL: el INSERT falla con un error interno del driver.
    const s = await sembrarSalida(sql, { capacity: 5 });
    const antes = await sql`select count(*)::int as n from bookings`;
    const creada = await reservar(origen, cuerpoReserva(s, { buyerName: "Nombre-Secreto\u0000X" }));
    expect(creada.status).toBe(500);
    expect(JSON.parse(creada.texto)).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno del servidor",
    });
    expect(creada.texto).not.toMatch(FUGAS);
    expect(await sql`select count(*)::int as n from bookings`).toEqual(antes);

    // Acciones de admin: el fallo ocurre al escribir el evento, después de cambiar la reserva;
    // la transacción lo revierte todo y la respuesta sigue siendo genérica.
    const r = await nueva();
    const cancelada = await nueva();
    await bookings.cancel(cancelada.id, { actorUserId: adminId, reason: "preparación" });
    const eventosAntes = await tipos(r.id);
    const hashAntes = (await filaDe(r.id)).access_token_hash;
    const mala = { reason: "Motivo-Secreto\u0000X" };
    const respuestas = [
      await llamar("cancel", { bookingId: r.id, ...mala }, cookies.admin),
      await llamar("regenerateToken", { bookingId: r.id, ...mala }, cookies.admin),
      await llamar("reactivate", { bookingId: cancelada.id, ...mala }, cookies.admin),
    ];
    for (const x of respuestas) {
      expect(x.status).toBe(500);
      expect(JSON.parse(x.texto)).toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Error interno del servidor",
      });
      expect(x.texto).not.toMatch(FUGAS);
    }
    expect((await filaDe(r.id)).status).toBe("pendiente");
    expect((await filaDe(r.id)).access_token_hash).toBe(hashAntes);
    expect(await tipos(r.id)).toEqual(eventosAntes);
    expect((await filaDe(cancelada.id)).status).toBe("cancelada");
  });

  test("ningún GET escribe datos de negocio, ni siquiera con una pendiente vencida", async () => {
    const vigente = await nueva();
    const vencida = await nueva();
    const cancelada = await nueva();
    await sql`update bookings set expires_at = now() - interval '1 minute' where id = ${vencida.id}`;
    await bookings.cancel(cancelada.id, { actorUserId: adminId, reason: "preparación" });
    const [{ package_id: paquete }] = await sql`select package_id from departures
      where id = ${vigente.departureId}`;

    const TABLAS = [
      "packages",
      "departures",
      "boarding_points",
      "departure_boarding_points",
      "media_assets",
      "bookings",
      "booking_passengers",
      "booking_events",
    ];
    // Huella de cada tabla de negocio (la sesión de Better Auth queda fuera: puede refrescarse al leer).
    const huella = async () => {
      const mapa: Record<string, string> = {};
      for (const tabla of TABLAS) {
        const [f] = await sql.unsafe(
          `select md5(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), '')) as h from ${tabla} t`,
        );
        mapa[tabla] = f.h;
      }
      return mapa;
    };
    const antes = await huella();

    const publicas = [
      "/",
      `/paquetes/${paquete}`,
      `/reservar/${vigente.departureId}`,
      `/reservas/${vigente.token}`,
      `/reservas/${vencida.token}`,
      `/reservas/${"A".repeat(43)}`,
      "/api/health",
      "/api/media/5f1c1c0e-0000-4000-8000-0000000000ff",
      "/login",
    ];
    const deAdmin = [
      "/admin",
      "/admin/catalogo",
      "/admin/catalogo/nuevo",
      `/admin/catalogo/${paquete}`,
      `/admin/catalogo/salidas/${vencida.departureId}/reservas`,
      `/admin/catalogo/salidas/${vigente.departureId}/reservas`,
    ];
    for (const ruta of publicas) await pagina(origen, ruta);
    for (const ruta of deAdmin) {
      const r = await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.admin! } });
      expect(r.status, ruta).toBeLessThan(500);
    }
    // Una Action invocada por GET tampoco muta nada.
    await fetch(`${origen}/_actions/bookings.cancel?bookingId=${vigente.id}&reason=x`, {
      headers: { cookie: cookies.admin! },
    });

    expect(await huella()).toEqual(antes);
    expect((await filaDe(vencida.id)).status).toBe("pendiente"); // vencida, sin materializar
    expect((await filaDe(vigente.id)).status).toBe("pendiente");
  });
});
