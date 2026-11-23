import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import path from "node:path";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";
import {
  construirAstro,
  esperarRespuesta,
  lanzar,
  puertoLibre,
  type ProcesoPrueba,
} from "../support/servidor";

// Prueba de autenticación con la app REAL (build de producción, como `bun run start`) sobre
// `traveltech_test`. Como en producción, el límite de intentos de Better Auth está activo.
// Igual que health.test.ts, genera el `dist/` de la raíz: no ejecutarla a la vez que otras.

const raiz = path.resolve(import.meta.dir, "../..");
const ORIGEN = "http://localhost:4321"; // APP_ORIGIN: Better Auth rechaza otros `Origin`
const CORREO = "admin@example.test";
const CONTRASENA = "Contrasena-de-prueba-1";

const base = abrirBaseDePruebas();
const procesos: ProcesoPrueba[] = [];
let origenServidor = "";

function entornoDe(urlBase: string, puerto: number) {
  const url = new URL(urlBase);
  url.pathname = "/traveltech_demo"; // otra base: la configuración exige que difieran
  return {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: urlBase,
    DEMO_DATABASE_URL: url.toString(),
    AUTH_SECRET: "ci-auth-secret-ficticio-solo-para-ci-0123456789",
    APP_ORIGIN: ORIGEN,
    PRIVATE_STORAGE_DIR: "./storage/private",
    DEMO_STORAGE_DIR: "./storage/demo",
    AGENCY_TIMEZONE: "America/Mexico_City",
    HOST: "127.0.0.1",
    PORT: String(puerto),
  };
}

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
    await recrearEsquema(sql); // comprueba que la base es traveltech_test antes de borrar nada
    await migrate(db, { migrationsFolder: "./src/db/migrations" });

    const puerto = await puertoLibre();
    origenServidor = `http://127.0.0.1:${puerto}`;
    const entorno = entornoDe(process.env.TEST_DATABASE_URL!, puerto);

    const crear = lanzar(
      [
        process.execPath,
        "run",
        "admin:create",
        "--email",
        CORREO,
        "--password",
        CONTRASENA,
        "--yes",
      ],
      { cwd: raiz, env: entorno },
    );
    expect(await crear.salio, crear.salida()).toBe(0);

    await construirAstro({ cwd: raiz, env: entorno, registrar: (p) => procesos.push(p) });
    const servidor = lanzar([process.execPath, "scripts/start.ts"], { cwd: raiz, env: entorno });
    procesos.push(servidor);
    await esperarRespuesta(`${origenServidor}/api/health`);
  }, 180_000);

  afterAll(async () => {
    await Promise.all(procesos.map((p) => p.detener()));
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
