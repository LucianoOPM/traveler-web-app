import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";

// Autenticación con la app REAL (build de producción) sobre `traveltech_test`; el límite de
// intentos de Better Auth está activo, como en producción.

const CORREO = "admin@example.test";
const base = abrirBaseDePruebas();
let origenServidor = "";
let detener = async () => {};

const post = (ruta: string, cuerpo: object, encabezados: Record<string, string> = {}) =>
  fetch(`${origenServidor}/api/auth${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGEN, ...encabezados },
    body: JSON.stringify(cuerpo),
  });

const iniciarSesion = (contrasena: string, encabezados: Record<string, string> = {}) =>
  post("/sign-in/email", { email: CORREO, password: contrasena }, encabezados);

/** `name=valor` de la cookie de sesión que fija la respuesta. */
const cookieDe = (respuesta: Response) =>
  respuesta.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.includes("session_token"));

const sesionCon = async (cookie: string) =>
  (await fetch(`${origenServidor}/api/auth/get-session`, { headers: { cookie } })).json();

// En local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("autenticación de personal", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    const app = await prepararAplicacion(sql, db, [{ correo: CORREO, rol: "admin" }]);
    origenServidor = app.origen;
    detener = async () => void (await app.detener());
  }, 180_000);

  afterAll(async () => {
    await detener();
    await sql.close();
  });

  test("el registro público está cerrado", async () => {
    const respuesta = await post("/sign-up/email", {
      name: "Intruso",
      email: "intruso@example.test",
      password: "Otra-contrasena-1",
    });
    expect(respuesta.ok).toBe(false);
    const [{ total }] = await sql`select count(*)::int as total from "user"`;
    expect(total).toBe(1); // solo el admin creado por el script
  });

  test("login correcto fija la cookie y la sesión es de un admin", async () => {
    const respuesta = await iniciarSesion(CONTRASENA);
    expect(respuesta.status).toBe(200);
    const cookie = cookieDe(respuesta);
    expect(cookie).toBeDefined();
    expect((await sesionCon(cookie!)).user.role).toBe("admin");
  });

  test("credenciales erróneas dan 401 sin cookie", async () => {
    const respuesta = await iniciarSesion("contrasena-equivocada");
    expect(respuesta.status).toBe(401);
    expect(cookieDe(respuesta)).toBeUndefined();
  });

  test("tras cerrar sesión, la sesión anterior deja de ser válida", async () => {
    const cookie = cookieDe(await iniciarSesion(CONTRASENA))!;
    expect((await sesionCon(cookie)).user.email).toBe(CORREO);
    expect((await post("/sign-out", {}, { cookie })).status).toBe(200);
    expect(await sesionCon(cookie)).toBeNull();
  });

  // Va al final: agota el cupo de /sign-in/email (3 por 10 s) y no debe afectar a las demás.
  test("el límite de intentos no se esquiva falseando x-forwarded-for", async () => {
    const estados: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const respuesta = await iniciarSesion("contrasena-equivocada", {
        "x-forwarded-for": `203.0.113.${i}`, // cada intento finge ser otra IP
      });
      estados.push(respuesta.status);
    }
    expect(estados).toContain(429);
  });
});
