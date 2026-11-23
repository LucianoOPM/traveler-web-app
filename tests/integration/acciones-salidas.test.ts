import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";

// Actions de salidas y puntos de abordaje con la app REAL (build de producción) y peticiones
// directas a `/_actions/…`. Construye `dist/`: no ejecutar a la vez que otras pruebas que
// construyan. Solo 2 inicios de sesión (el límite de Better Auth es 3 por 10 s).

const ADMIN = "admin-salidas@example.test";
const OPERADOR = "operador-salidas@example.test";
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
  const respuesta = await fetch(`${origen}/_actions/catalog.${accion}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, texto, error: respuesta.ok ? undefined : JSON.parse(texto) };
};

const CONTENIDO = {
  startsAt: "2027-01-10T10:00:00Z",
  endsAt: "2027-01-12T10:00:00Z",
  capacity: 10,
  adultPriceCents: 150000,
  childPriceCents: 100000,
  infantPriceCents: 0,
};
const INEXISTENTE = "5f1c1c0e-0000-4000-8000-0000000000ff";

describe.skipIf(!base && !process.env.CI)("Actions de salidas y puntos de abordaje", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    const app = await prepararAplicacion(sql, db, [
      { correo: ADMIN, rol: "admin" },
      { correo: OPERADOR, rol: "operator" },
    ]);
    origen = app.origen;
    detener = async () => void (await app.detener());
    cookies.admin = await iniciarSesion(ADMIN);
    cookies.operador = await iniciarSesion(OPERADOR);
  }, 180_000);

  afterAll(async () => {
    await detener();
    await sql.close();
  });

  const crearPaquete = async (status = "publicado") =>
    (
      await sql`insert into packages (name, summary, description, status)
        values ('Cancún', 's', 'd', ${status}) returning id`
    )[0].id as string;
  const crearSalida = async (status = "borrador", paquete?: string) =>
    (
      await sql`insert into departures (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents, status)
        values (${paquete ?? (await crearPaquete())}, ${CONTENIDO.startsAt}, ${CONTENIDO.endsAt}, 10, 1, 1, 0, ${status}) returning id`
    )[0].id as string;
  const crearPunto = async (name = `Punto ${crypto.randomUUID()}`) =>
    (await sql`insert into boarding_points (name) values (${name}) returning id`)[0].id as string;
  const estado = async (id: string) =>
    (await sql`select status from departures where id = ${id}`)[0]?.status as string | undefined;
  const contar = async (tabla: "departures" | "boarding_points" | "departure_boarding_points") =>
    (await sql`select count(*)::int as n from ${sql(tabla)}`)[0].n as number;

  const ACCIONES: Array<[string, () => Promise<Record<string, unknown>>]> = [
    ["createDeparture", async () => ({ packageId: await crearPaquete(), ...CONTENIDO })],
    ["editDeparture", async () => ({ id: await crearSalida(), capacity: 5 })],
    ["publishDeparture", async () => ({ id: await crearSalida() })],
    ["cancelDeparture", async () => ({ id: await crearSalida("publicada") })],
    ["deleteDeparture", async () => ({ id: await crearSalida() })],
    [
      "assignBoardingPoint",
      async () => ({ departureId: await crearSalida(), boardingPointId: await crearPunto() }),
    ],
    [
      "removeBoardingPoint",
      async () => ({ departureId: await crearSalida(), boardingPointId: await crearPunto() }),
    ],
    ["createBoardingPoint", async () => ({ name: "Terminal Norte" })],
    ["editBoardingPoint", async () => ({ id: await crearPunto(), name: "Otro" })],
    ["deleteBoardingPoint", async () => ({ id: await crearPunto() })],
  ];

  describe.each(ACCIONES)("%s", (accion, cuerpo) => {
    test("sin sesión → 401", async () => {
      expect((await llamar(accion, await cuerpo())).status).toBe(401);
    });
    test("operador → 403 y no cambia nada", async () => {
      const datos = await cuerpo();
      const antes = [
        await contar("departures"),
        await contar("boarding_points"),
        await contar("departure_boarding_points"),
      ];
      const filas = await sql`select id, status from departures order by id`;
      expect((await llamar(accion, datos, cookies.operador)).status).toBe(403);
      expect([
        await contar("departures"),
        await contar("boarding_points"),
        await contar("departure_boarding_points"),
      ]).toEqual(antes);
      expect(await sql`select id, status from departures order by id`).toEqual(filas);
    });
  });

  test("el admin programa una salida con tarifas, capacidad y puntos de abordaje", async () => {
    const paquete = await crearPaquete();
    const creada = await llamar(
      "createDeparture",
      { packageId: paquete, ...CONTENIDO },
      cookies.admin,
    );
    expect(creada.status).toBe(200);
    const [{ id }] = await sql`select id from departures where package_id = ${paquete}`;

    expect((await llamar("editDeparture", { id, capacity: 20 }, cookies.admin)).status).toBe(200);
    const punto = (await llamar(
      "createBoardingPoint",
      { name: "Terminal Norte" },
      cookies.admin,
    )) as unknown;
    expect((punto as { status: number }).status).toBe(200);
    const [{ id: puntoId }] =
      await sql`select id from boarding_points where name = 'Terminal Norte'`;

    const asignacion = { departureId: id, boardingPointId: puntoId };
    expect((await llamar("assignBoardingPoint", asignacion, cookies.admin)).status).toBe(200);
    expect((await llamar("publishDeparture", { id }, cookies.admin)).status).toBe(200);
    expect(await estado(id)).toBe("publicada");
    // Publicada: sigue editable y admite quitar puntos.
    expect((await llamar("editDeparture", { id, capacity: 30 }, cookies.admin)).status).toBe(200);
    expect((await llamar("removeBoardingPoint", asignacion, cookies.admin)).status).toBe(200);
    expect((await llamar("cancelDeparture", { id }, cookies.admin)).status).toBe(200);
    expect(await estado(id)).toBe("cancelada");

    const [fila] = await sql`select capacity, adult_price_cents from departures where id = ${id}`;
    expect(fila).toMatchObject({ capacity: 30, adult_price_cents: 150000 });
  });

  test("un campo desconocido → 400 y no persiste", async () => {
    const paquete = await crearPaquete();
    const respuesta = await llamar(
      "createDeparture",
      { packageId: paquete, ...CONTENIDO, status: "publicada" },
      cookies.admin,
    );
    expect(respuesta.status).toBe(400);
    expect(await sql`select 1 from departures where package_id = ${paquete}`).toHaveLength(0);
  });

  test.each([
    ["tarifa con decimales", { adultPriceCents: 10.5 }, 400],
    ["capacidad con decimales", { capacity: 1.5 }, 400],
    ["capacidad mayor que int32", { capacity: 2 ** 31 }, 400],
    ["fecha con offset (no UTC)", { startsAt: "2027-01-10T10:00:00+02:00" }, 400],
    ["fecha no ISO", { endsAt: "mañana" }, 400],
    ["packageId no UUID", { packageId: "abc" }, 400],
    ["capacidad negativa", { capacity: -1 }, 422],
    ["tarifa negativa", { infantPriceCents: -1 }, 422],
    ["ends_at anterior a starts_at", { endsAt: "2027-01-09T10:00:00Z" }, 422],
    ["ends_at igual a starts_at", { endsAt: "2027-01-10T10:00:00Z" }, 422],
  ])("crear con %s → %i", async (_nombre, cambio, codigo) => {
    const paquete = await crearPaquete();
    const respuesta = await llamar(
      "createDeparture",
      { packageId: paquete, ...CONTENIDO, ...cambio },
      cookies.admin,
    );
    expect(respuesta.status).toBe(codigo);
    expect(await sql`select 1 from departures where package_id = ${paquete}`).toHaveLength(0);
  });

  test("crear en un paquete inexistente → 404", async () => {
    const respuesta = await llamar(
      "createDeparture",
      { packageId: INEXISTENTE, ...CONTENIDO },
      cookies.admin,
    );
    expect(respuesta.status).toBe(404);
  });

  test("editar con un rango de fechas inválido → 422 y no cambia", async () => {
    const id = await crearSalida();
    const respuesta = await llamar(
      "editDeparture",
      { id, endsAt: "2027-01-01T00:00:00Z" },
      cookies.admin,
    );
    expect(respuesta.status).toBe(422);
    expect((await sql`select capacity from departures where id = ${id}`)[0].capacity).toBe(10);
  });

  test("publicar exige paquete publicado (422); con paquete publicado → 200", async () => {
    const borradorPaquete = await crearSalida("borrador", await crearPaquete("borrador"));
    expect((await llamar("publishDeparture", { id: borradorPaquete }, cookies.admin)).status).toBe(
      422,
    );
    expect(await estado(borradorPaquete)).toBe("borrador");

    const archivado = await crearSalida("borrador", await crearPaquete("archivado"));
    expect((await llamar("publishDeparture", { id: archivado }, cookies.admin)).status).toBe(422);

    const ok = await crearSalida();
    expect((await llamar("publishDeparture", { id: ok }, cookies.admin)).status).toBe(200);
  });

  test("transiciones inválidas → 422: republicar, cancelar un borrador, reabrir una cancelada", async () => {
    const publicada = await crearSalida("publicada");
    expect((await llamar("publishDeparture", { id: publicada }, cookies.admin)).status).toBe(422);
    const borrador = await crearSalida();
    expect((await llamar("cancelDeparture", { id: borrador }, cookies.admin)).status).toBe(422);
    const cancelada = await crearSalida("cancelada");
    expect((await llamar("publishDeparture", { id: cancelada }, cookies.admin)).status).toBe(422);
    expect((await llamar("cancelDeparture", { id: cancelada }, cookies.admin)).status).toBe(422);
    expect(await estado(cancelada)).toBe("cancelada");
  });

  test("una cancelada no se edita ni cambia sus puntos (422)", async () => {
    const id = await crearSalida("cancelada");
    const punto = await crearPunto();
    expect((await llamar("editDeparture", { id, capacity: 5 }, cookies.admin)).status).toBe(422);
    const par = { departureId: id, boardingPointId: punto };
    expect((await llamar("assignBoardingPoint", par, cookies.admin)).status).toBe(422);
    expect((await llamar("removeBoardingPoint", par, cookies.admin)).status).toBe(422);
    expect((await sql`select capacity from departures where id = ${id}`)[0].capacity).toBe(10);
  });

  test("solo se eliminan borradores (422) y su eliminación borra las asignaciones", async () => {
    for (const status of ["publicada", "cancelada"]) {
      const id = await crearSalida(status);
      expect((await llamar("deleteDeparture", { id }, cookies.admin)).status).toBe(422);
      expect(await estado(id)).toBe(status);
    }
    const id = await crearSalida();
    const punto = await crearPunto();
    await sql`insert into departure_boarding_points (departure_id, boarding_point_id) values (${id}, ${punto})`;
    expect((await llamar("deleteDeparture", { id }, cookies.admin)).status).toBe(200);
    expect(await estado(id)).toBeUndefined();
    expect(
      await sql`select 1 from departure_boarding_points where departure_id = ${id}`,
    ).toHaveLength(0);
  });

  test("asignar dos veces el mismo punto → 409 con una sola fila", async () => {
    const departureId = await crearSalida();
    const boardingPointId = await crearPunto();
    const par = { departureId, boardingPointId };
    expect((await llamar("assignBoardingPoint", par, cookies.admin)).status).toBe(200);
    expect((await llamar("assignBoardingPoint", par, cookies.admin)).status).toBe(409);
    expect(
      await sql`select 1 from departure_boarding_points where departure_id = ${departureId}`,
    ).toHaveLength(1);
  });

  test("puntos inexistentes → 404; quitar uno no asignado → 404", async () => {
    const departureId = await crearSalida();
    expect(
      (
        await llamar(
          "assignBoardingPoint",
          { departureId, boardingPointId: INEXISTENTE },
          cookies.admin,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await llamar(
          "removeBoardingPoint",
          { departureId, boardingPointId: await crearPunto() },
          cookies.admin,
        )
      ).status,
    ).toBe(404);
    expect(
      (await llamar("editBoardingPoint", { id: INEXISTENTE, name: "x" }, cookies.admin)).status,
    ).toBe(404);
    expect((await llamar("deleteBoardingPoint", { id: INEXISTENTE }, cookies.admin)).status).toBe(
      404,
    );
  });

  test("puntos de abordaje: nombre vacío → 422; duplicado → 409; borrar uno asignado → 409", async () => {
    expect((await llamar("createBoardingPoint", { name: "  " }, cookies.admin)).status).toBe(422);
    const nombre = `Duplicado ${crypto.randomUUID()}`;
    expect((await llamar("createBoardingPoint", { name: nombre }, cookies.admin)).status).toBe(200);
    expect((await llamar("createBoardingPoint", { name: nombre }, cookies.admin)).status).toBe(409);

    const otro = await crearPunto();
    expect(
      (await llamar("editBoardingPoint", { id: otro, name: nombre }, cookies.admin)).status,
    ).toBe(409);

    const departureId = await crearSalida();
    const asignado = await crearPunto();
    await sql`insert into departure_boarding_points (departure_id, boarding_point_id) values (${departureId}, ${asignado})`;
    expect((await llamar("deleteBoardingPoint", { id: asignado }, cookies.admin)).status).toBe(409);
    expect(await sql`select 1 from boarding_points where id = ${asignado}`).toHaveLength(1);
    expect((await llamar("deleteBoardingPoint", { id: otro }, cookies.admin)).status).toBe(200);
  });

  test("un error inesperado no filtra su mensaje", async () => {
    // Un NUL no es texto válido en PostgreSQL: el INSERT falla con un error interno del driver.
    const respuesta = await llamar("createBoardingPoint", { name: "A\u0000B" }, cookies.admin);
    expect(respuesta.status).toBe(500);
    expect(respuesta.error.message).toBe("Error interno del servidor");
    expect(respuesta.texto).not.toMatch(/utf8|byte|invalid|postgres|boarding_points/i);
  });
});
