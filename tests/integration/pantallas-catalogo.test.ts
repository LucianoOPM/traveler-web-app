import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { localAUtc } from "@lib/fechas";
import { pesosACentavos } from "@lib/importes";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";

// Pantallas del catálogo con la app REAL (build de producción): rutas protegidas, lectura SSR y el
// recorrido «crear y publicar un paquete con varias salidas» con las mismas conversiones que usan las
// islands. No hay prueba de navegador (PEN-13). Construye `dist/`: no ejecutar junto a otras pruebas
// que construyan. Solo 2 inicios de sesión (el límite de Better Auth es 3 por 10 s).

const ADMIN = "admin-pantallas@example.test";
const OPERADOR = "operador-pantallas@example.test";
const ZONA = "America/Mexico_City";
const INEXISTENTE = "5f1c1c0e-0000-4000-8000-0000000000ff";
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

const pagina = (ruta: string, cookie?: string) =>
  fetch(`${origen}${ruta}`, { redirect: "manual", headers: cookie ? { cookie } : {} });

// Devuelve el JSON de la respuesta de la Action (devalue: se lee con `JSON.parse` solo para el id).
const llamar = async (accion: string, cuerpo: unknown, cookie: string) => {
  const respuesta = await fetch(`${origen}/_actions/catalog.${accion}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(cuerpo),
  });
  return { status: respuesta.status, texto: await respuesta.text() };
};

// Una respuesta de Action serializada con devalue: el `id` es el primer UUID que aparece.
const idDe = (texto: string) =>
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(texto)![0];

describe.skipIf(!base && !process.env.CI)("pantallas del catálogo", () => {
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

  const RUTAS = ["/admin/catalogo", "/admin/catalogo/nuevo", `/admin/catalogo/${INEXISTENTE}`];

  test.each(RUTAS)("sin sesión, %s redirige a /login sin cachear", async (ruta) => {
    const respuesta = await pagina(ruta);
    expect(respuesta.status).toBe(302);
    expect(respuesta.headers.get("location")).toBe("/login");
    expect(respuesta.headers.get("cache-control")).toContain("no-store");
  });

  test.each(RUTAS)("el operador recibe 403 en %s", async (ruta) => {
    const respuesta = await pagina(ruta, cookies.operador);
    expect(respuesta.status).toBe(403);
    expect(await respuesta.text()).not.toContain("Nuevo paquete");
  });

  test("el operador sigue entrando a /admin, sin enlace al catálogo; el admin sí lo ve", async () => {
    const operador = await (await pagina("/admin", cookies.operador)).text();
    expect(operador).not.toContain("/admin/catalogo");
    expect(await (await pagina("/admin", cookies.admin)).text()).toContain("/admin/catalogo");
  });

  test("el admin ve la lista; un id inválido o inexistente da 404 (no 500)", async () => {
    const lista = await pagina("/admin/catalogo", cookies.admin);
    expect(lista.status).toBe(200);
    expect(await lista.text()).toContain("Nuevo paquete");
    expect((await pagina("/admin/catalogo/nuevo", cookies.admin)).status).toBe(200);
    expect((await pagina("/admin/catalogo/no-es-uuid", cookies.admin)).status).toBe(404);
    expect((await pagina(`/admin/catalogo/${INEXISTENTE}`, cookies.admin)).status).toBe(404);
  });

  test("el admin crea y publica un paquete con varias salidas, con importes y fechas convertidos", async () => {
    const creado = await llamar(
      "createPackage",
      { name: "Cancún pantallas", summary: "", description: "" },
      cookies.admin,
    );
    expect(creado.status).toBe(200);
    const paquete = idDe(creado.texto);
    expect(
      (
        await llamar(
          "editPackage",
          { id: paquete, summary: "Playa", description: "Siete días" },
          cookies.admin,
        )
      ).status,
    ).toBe(200);
    expect((await llamar("publishPackage", { id: paquete }, cookies.admin)).status).toBe(200);

    // Lo mismo que hace la isla: texto en pesos y hora local → centavos y UTC.
    const contenido = (inicio: string, fin: string, adulto: string) => ({
      packageId: paquete,
      startsAt: localAUtc(inicio, ZONA)!,
      endsAt: localAUtc(fin, ZONA)!,
      capacity: 20,
      adultPriceCents: pesosACentavos(adulto)!,
      childPriceCents: pesosACentavos("1000")!,
      infantPriceCents: pesosACentavos("0")!,
    });
    const primera = await llamar(
      "createDeparture",
      contenido("2027-01-10T22:00", "2027-01-15T10:00", "1500.50"),
      cookies.admin,
    );
    const segunda = await llamar(
      "createDeparture",
      contenido("2027-02-10T08:00", "2027-02-15T10:00", "19.99"),
      cookies.admin,
    );
    expect([primera.status, segunda.status]).toEqual([200, 200]);

    const punto = await llamar(
      "createBoardingPoint",
      { name: "Terminal pantallas" },
      cookies.admin,
    );
    const puntoId = idDe(punto.texto);
    for (const salida of [primera, segunda]) {
      const departureId = idDe(salida.texto);
      expect(
        (
          await llamar(
            "assignBoardingPoint",
            { departureId, boardingPointId: puntoId },
            cookies.admin,
          )
        ).status,
      ).toBe(200);
      expect((await llamar("publishDeparture", { id: departureId }, cookies.admin)).status).toBe(
        200,
      );
    }

    const filas = await sql`select starts_at, adult_price_cents, status from departures
      where package_id = ${paquete} order by starts_at`;
    expect(filas.map((f: { status: string }) => f.status)).toEqual(["publicada", "publicada"]);
    expect(filas.map((f: { adult_price_cents: number }) => f.adult_price_cents)).toEqual([
      150050, 1999,
    ]);
    // 22:00 en la agencia (UTC−6) es el día siguiente en UTC.
    expect(new Date(filas[0].starts_at).toISOString()).toBe("2027-01-11T04:00:00.000Z");

    // Lectura SSR: la página muestra las dos salidas en hora de la agencia y los importes en pesos.
    const html = await (await pagina(`/admin/catalogo/${paquete}`, cookies.admin)).text();
    expect(html).toContain("Cancún pantallas");
    expect(html).toContain("2027-01-10T22:00");
    expect(html).toContain("2027-02-10T08:00");
    expect(html).toContain("1500.50");
    expect(html).toContain("19.99");
    expect(html).toContain("Terminal pantallas");
    expect(await (await pagina("/admin/catalogo", cookies.admin)).text()).toContain(
      "Cancún pantallas",
    );
  });

  test("una clave desconocida en una Action no persiste (400) y el operador no escribe (403)", async () => {
    const antes = (await sql`select count(*)::int as n from packages`)[0].n;
    expect(
      (await llamar("createPackage", { name: "X", status: "publicado" }, cookies.admin)).status,
    ).toBe(400);
    expect((await llamar("createPackage", { name: "X" }, cookies.operador)).status).toBe(403);
    expect((await sql`select count(*)::int as n from packages`)[0].n).toBe(antes);
  });
});
