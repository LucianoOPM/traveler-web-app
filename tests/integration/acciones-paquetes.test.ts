import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";

// Actions de paquetes con la app REAL (build de producción) y peticiones directas a `/_actions/…`.
// Construye `dist/`: no ejecutar a la vez que otras pruebas que construyan. Solo 2 inicios de
// sesión (el límite de Better Auth es 3 por 10 s).

const ADMIN = "admin-paquetes@example.test";
const OPERADOR = "operador-paquetes@example.test";
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

describe.skipIf(!base && !process.env.CI)("Actions de paquetes", () => {
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

  const crearBorrador = async (campos: Record<string, string> = {}) => {
    const { name = "Cancún", summary = "Resumen", description = "Descripción" } = campos;
    const [fila] = await sql`insert into packages (name, summary, description)
      values (${name}, ${summary}, ${description}) returning id`;
    return fila.id as string;
  };
  const estado = async (id: string) =>
    (await sql`select status from packages where id = ${id}`)[0]?.status as string | undefined;

  const ACCIONES: Array<[string, () => Promise<Record<string, unknown>>]> = [
    ["createPackage", async () => ({ name: "Cancún" })],
    ["editPackage", async () => ({ id: await crearBorrador(), name: "Otro" })],
    ["publishPackage", async () => ({ id: await crearBorrador() })],
    ["archivePackage", async () => ({ id: await crearBorrador() })],
    ["deletePackage", async () => ({ id: await crearBorrador() })],
  ];

  describe.each(ACCIONES)("%s", (accion, cuerpo) => {
    test("sin sesión → 401", async () => {
      expect((await llamar(accion, await cuerpo())).status).toBe(401);
    });
    test("operador → 403 y no cambia nada", async () => {
      const datos = await cuerpo();
      const [{ n: antes }] = await sql`select count(*)::int as n from packages`;
      expect((await llamar(accion, datos, cookies.operador)).status).toBe(403);
      const [{ n: despues }] = await sql`select count(*)::int as n from packages`;
      expect(despues).toBe(antes);
    });
  });

  test("el admin crea, edita, publica, archiva y elimina un borrador", async () => {
    const creado = await llamar("createPackage", { name: "Cancún" }, cookies.admin);
    expect(creado.status).toBe(200);
    const [{ id }] = await sql`select id from packages where name = 'Cancún'`;

    expect(
      (await llamar("editPackage", { id, summary: "Resumen", description: "Texto" }, cookies.admin))
        .status,
    ).toBe(200);
    expect((await llamar("publishPackage", { id }, cookies.admin)).status).toBe(200);
    expect(await estado(id)).toBe("publicado");
    expect((await llamar("archivePackage", { id }, cookies.admin)).status).toBe(200);
    expect(await estado(id)).toBe("archivado");

    const borrador = await crearBorrador();
    expect((await llamar("deletePackage", { id: borrador }, cookies.admin)).status).toBe(200);
    expect(await estado(borrador)).toBeUndefined();
  });

  test("crear con nombre vacío → 400 con el error del campo en español", async () => {
    const respuesta = await llamar("createPackage", { name: "  " }, cookies.admin);
    expect(respuesta.status).toBe(400);
    expect(respuesta.texto).toContain("El nombre es obligatorio");
  });

  test("un campo desconocido → 400", async () => {
    const respuesta = await llamar("createPackage", { name: "A", role: "admin" }, cookies.admin);
    expect(respuesta.status).toBe(400);
    expect(await sql`select 1 from packages where name = 'A'`).toHaveLength(0);
  });

  test("un paquete publicado no se elimina (422), tampoco con salidas", async () => {
    const id = await crearBorrador();
    await llamar("publishPackage", { id }, cookies.admin);
    await sql`insert into departures (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents)
      values (${id}, '2027-01-10T10:00:00Z', '2027-01-12T10:00:00Z', 10, 1, 1, 0)`;
    const respuesta = await llamar("deletePackage", { id }, cookies.admin);
    expect(respuesta.status).toBe(422);
    expect(await estado(id)).toBe("publicado");
  });

  test("eliminar un borrador con salidas → 409", async () => {
    const id = await crearBorrador();
    await sql`insert into departures (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents)
      values (${id}, '2027-01-10T10:00:00Z', '2027-01-12T10:00:00Z', 10, 1, 1, 0)`;
    expect((await llamar("deletePackage", { id }, cookies.admin)).status).toBe(409);
    expect(await estado(id)).toBe("borrador");
  });

  test("publicar con un campo vacío → 422; id inexistente → 404", async () => {
    const id = await crearBorrador({ description: "" });
    expect((await llamar("publishPackage", { id }, cookies.admin)).status).toBe(422);
    const inexistente = "5f1c1c0e-0000-4000-8000-0000000000ff";
    expect((await llamar("publishPackage", { id: inexistente }, cookies.admin)).status).toBe(404);
  });

  test("un error inesperado no filtra su mensaje", async () => {
    // Un NUL no es texto válido en PostgreSQL: el INSERT falla con un error interno del driver.
    const respuesta = await llamar("createPackage", { name: "A\u0000B" }, cookies.admin);
    expect(respuesta.status).toBe(500);
    expect(respuesta.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(respuesta.error.message).toBe("Error interno del servidor");
    expect(respuesta.texto).not.toMatch(/utf8|byte|invalid|postgres|packages/i);
  });
});
