import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";

// Control de acceso por ruta con la app REAL (build de producción) sobre `traveltech_test`.
// El límite de intentos permite 3 inicios de sesión por 10 s: aquí se hacen exactamente 3, al
// empezar, y las cookies se reutilizan.

const ADMIN = "admin@example.test";
const OPERADOR = "operador@example.test";
const AJENO = "ajeno@example.test"; // existe, pero su rol no es de personal
const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};
const cookies: Record<string, string> = {};

const pedir = (ruta: string, cookie?: string) =>
  fetch(`${origen}${ruta}`, { redirect: "manual", headers: cookie ? { cookie } : {} });

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

// En local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("rutas protegidas de /admin", () => {
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
      { correo: AJENO, rol: "operator" },
    ]);
    origen = app.origen;
    detener = async () => void (await app.detener());
    await sql`update "user" set role = 'cliente' where email = ${AJENO}`;
    cookies.admin = await iniciarSesion(ADMIN);
    cookies.operador = await iniciarSesion(OPERADOR);
    cookies.ajeno = await iniciarSesion(AJENO);
  }, 180_000);

  afterAll(async () => {
    await detener();
    await sql.close();
  });

  test("sin sesión, /admin y sus subrutas redirigen a /login sin cachear", async () => {
    for (const ruta of ["/admin", "/admin/otra-pagina"]) {
      const respuesta = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(302);
      expect(respuesta.headers.get("location"), ruta).toBe("/login");
      expect(respuesta.headers.get("cache-control"), ruta).toContain("no-store");
    }
  });

  test("una cookie inventada tampoco entra", async () => {
    const respuesta = await pedir("/admin", "better-auth.session_token=inventada.firma");
    expect(respuesta.status).toBe(302);
    expect(respuesta.headers.get("location")).toBe("/login");
  });

  test("admin y operador entran a /admin", async () => {
    for (const quien of ["admin", "operador"]) {
      const respuesta = await pedir("/admin", cookies[quien]);
      expect(respuesta.status, quien).toBe(200);
      expect(respuesta.headers.get("cache-control"), quien).toContain("no-store");
      expect(await respuesta.text(), quien).toContain("Bienvenido");
    }
  });

  test("un usuario sin rol de personal recibe 403", async () => {
    const respuesta = await pedir("/admin", cookies.ajeno);
    expect(respuesta.status).toBe(403);
    expect(await respuesta.text()).not.toContain("Bienvenido");
  });

  test("un operador vetado recibe 403 aunque conserve la sesión", async () => {
    await sql`update "user" set banned = true where email = ${OPERADOR}`;
    expect((await pedir("/admin", cookies.operador)).status).toBe(403);
  });

  test("/login muestra el formulario sin sesión y redirige a /admin con sesión", async () => {
    const sinSesion = await pedir("/login");
    expect(sinSesion.status).toBe(200);
    const html = await sinSesion.text();
    expect(html).toContain('id="login"');
    expect(html).toContain("/api/auth/sign-in/email"); // el script de cliente llega a la página
    const conSesion = await pedir("/login", cookies.admin);
    expect(conSesion.status).toBe(302);
    expect(conSesion.headers.get("location")).toBe("/admin");
  });

  // Va al final: invalida la sesión de admin que usan las demás.
  test("tras cerrar sesión, la cookie anterior ya no permite acceder a /admin", async () => {
    expect((await pedir("/admin", cookies.admin)).status).toBe(200);
    const salida = await fetch(`${origen}/api/auth/sign-out`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGEN, cookie: cookies.admin! },
      body: "{}",
    });
    expect(salida.status).toBe(200);
    const despues = await pedir("/admin", cookies.admin);
    expect(despues.status).toBe(302);
    expect(despues.headers.get("location")).toBe("/login");
  });
});
