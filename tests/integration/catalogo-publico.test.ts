import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { prepararAplicacion } from "../support/aplicacion";

// Catálogo público con la app REAL (build de producción) y SIN sesión: ninguna petición lleva
// cookies. Los datos se insertan por SQL (no hay Actions de por medio) con fechas lejanas para que
// «futuras» no caduque. Construye `dist/`: no ejecutar junto a otras pruebas que construyan.

const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};

const pagina = (ruta: string) => fetch(`${origen}${ruta}`, { redirect: "manual" });
const h1 = (html: string) => html.match(/<h1[\s>]/g)?.length ?? 0;
const sinEspacios = (texto: string) => texto.replace(/\s/g, " ");

const ids = {
  publicado: "5f1c1c0e-0000-4000-8000-0000000000a1",
  sinSalidas: "5f1c1c0e-0000-4000-8000-0000000000a2",
  borrador: "5f1c1c0e-0000-4000-8000-0000000000a3",
  archivado: "5f1c1c0e-0000-4000-8000-0000000000a4",
  inexistente: "5f1c1c0e-0000-4000-8000-0000000000ff",
  salidaA: "5f1c1c0e-0000-4000-8000-0000000000c1",
  salidaB: "5f1c1c0e-0000-4000-8000-0000000000c2",
  salidaCancelada: "5f1c1c0e-0000-4000-8000-0000000000c3",
  salidaBorrador: "5f1c1c0e-0000-4000-8000-0000000000c4",
  salidaPasada: "5f1c1c0e-0000-4000-8000-0000000000c5",
  salidaDelBorrador: "5f1c1c0e-0000-4000-8000-0000000000c6",
  puntoNorte: "5f1c1c0e-0000-4000-8000-0000000000b1",
  puntoSoloCancelada: "5f1c1c0e-0000-4000-8000-0000000000b2",
};

describe.skipIf(!base && !process.env.CI)("catálogo público", () => {
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

    const paquete = (id: string, nombre: string, estado: string) =>
      sql`insert into packages (id, name, summary, description, status)
        values (${id}, ${nombre}, ${`Resumen de ${nombre}`}, ${`Descripción de ${nombre}`}, ${estado})`;
    await paquete(ids.publicado, "Cancún público", "publicado");
    await paquete(ids.sinSalidas, "Oaxaca sin salidas", "publicado");
    await paquete(ids.borrador, "Secreto borrador", "borrador");
    await paquete(ids.archivado, "Secreto archivado", "archivado");

    // id, paquete, inicio, capacidad, adulto, menor, infante, estado
    const salida = (
      id: string,
      paqueteId: string,
      inicio: string,
      capacidad: number,
      adulto: number,
      menor: number,
      infante: number,
      estado: string,
    ) =>
      sql`insert into departures (id, package_id, starts_at, ends_at, capacity,
          adult_price_cents, child_price_cents, infant_price_cents, status)
        values (${id}, ${paqueteId}, ${inicio}::timestamptz, ${inicio}::timestamptz + interval '5 days',
          ${capacidad}, ${adulto}, ${menor}, ${infante}, ${estado})`;
    // 04:00Z = 22:00 del día anterior en la agencia (UTC−6).
    await salida(
      ids.salidaA,
      ids.publicado,
      "2099-01-11T04:00:00Z",
      20,
      150050,
      100000,
      0,
      "publicada",
    );
    await salida(
      ids.salidaB,
      ids.publicado,
      "2099-02-10T14:00:00Z",
      35,
      1999,
      1000,
      500,
      "publicada",
    );
    await salida(
      ids.salidaCancelada,
      ids.publicado,
      "2099-03-10T14:00:00Z",
      11,
      77777,
      77777,
      77777,
      "cancelada",
    );
    await salida(
      ids.salidaBorrador,
      ids.publicado,
      "2099-04-10T14:00:00Z",
      12,
      88888,
      88888,
      88888,
      "borrador",
    );
    await salida(
      ids.salidaPasada,
      ids.publicado,
      "2020-05-10T14:00:00Z",
      13,
      66666,
      66666,
      66666,
      "publicada",
    );
    await salida(
      ids.salidaDelBorrador,
      ids.borrador,
      "2099-06-10T14:00:00Z",
      14,
      55555,
      55555,
      55555,
      "publicada",
    );

    await sql`insert into boarding_points (id, name) values
      (${ids.puntoNorte}, 'Terminal Norte'), (${ids.puntoSoloCancelada}, 'Punto solo de cancelada')`;
    await sql`insert into departure_boarding_points (departure_id, boarding_point_id) values
      (${ids.salidaA}, ${ids.puntoNorte}), (${ids.salidaB}, ${ids.puntoNorte}),
      (${ids.salidaCancelada}, ${ids.puntoSoloCancelada})`;
  }, 180_000);

  afterAll(async () => {
    await detener();
    await sql.close();
  });

  test("el visitante sin sesión ve la lista: publicados con salidas próximas, sin lo no publicado", async () => {
    const respuesta = await pagina("/");
    expect(respuesta.status).toBe(200);
    const html = await respuesta.text();
    expect(h1(html)).toBe(1);
    expect(html).toContain("Cancún público");
    expect(html).toContain("Resumen de Cancún público");
    expect(html).toContain("10 de enero de 2099"); // 22:00 en la agencia, no el día UTC
    expect(html).toContain("Oaxaca sin salidas");
    expect(html).toContain("Sin salidas próximas");
    expect(html).not.toContain("Secreto");
    expect(html).not.toContain("Clics"); // la página de ejemplo (Counter) ya no existe
    expect(sinEspacios(html)).not.toContain("$777.77");
  });

  test("el detalle muestra tarifas, plazas, fechas de la agencia y puntos de abordaje", async () => {
    const respuesta = await pagina(`/paquetes/${ids.publicado}`);
    expect(respuesta.status).toBe(200);
    const html = sinEspacios(await respuesta.text());
    expect(h1(html)).toBe(1);
    expect(html).toContain("Cancún público");
    expect(html).toContain("Descripción de Cancún público");
    // Salida A: tarifas, plazas y fecha (22:00 del 10 de enero en la agencia).
    expect(html).toContain("$1,500.50");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("$0.00");
    expect(html).toContain("10 de enero de 2099");
    expect(html).toContain("22:00");
    expect(html).toContain(">20<"); // plazas = capacidad mientras no existan reservas
    // Salida B.
    expect(html).toContain("$19.99");
    expect(html).toContain("$10.00");
    expect(html).toContain("$5.00");
    expect(html).toContain(">35<");
    expect(html).toContain("Terminal Norte");
    // Cancelada, borrador y pasada no aparecen (ni sus tarifas, capacidades o puntos).
    for (const oculto of ["$777.77", "$888.88", "$666.66", ">11<", ">12<", ">13<"]) {
      expect(html, oculto).not.toContain(oculto);
    }
    expect(html).not.toContain("Punto solo de cancelada");
  });

  test("un paquete publicado sin salidas futuras sigue visible", async () => {
    const respuesta = await pagina(`/paquetes/${ids.sinSalidas}`);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.text()).toContain("Sin salidas próximas");
  });

  test("borrador, archivado, inexistente e id inválido dan el mismo 404", async () => {
    const rutas = [ids.borrador, ids.archivado, ids.inexistente, "no-es-uuid"].map(
      (id) => `/paquetes/${id}`,
    );
    const respuestas = await Promise.all(rutas.map(pagina));
    const cuerpos = await Promise.all(respuestas.map((r) => r.text()));
    const cabeceras = respuestas.map((r) => [
      r.status,
      r.headers.get("content-type"),
      r.headers.get("cache-control"),
    ]);
    expect(respuestas.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(cuerpos).size).toBe(1);
    expect(new Set(cabeceras.map((c) => JSON.stringify(c))).size).toBe(1);
    for (const cuerpo of cuerpos) expect(cuerpo).not.toContain("Secreto");
  });

  test("ninguna página contiene campos ni identificadores internos", async () => {
    const textos = [
      await (await pagina("/")).text(),
      await (await pagina(`/paquetes/${ids.publicado}`)).text(),
    ];
    const internos = [
      "status",
      "createdat",
      "created_at",
      "updatedat",
      "updated_at",
      "publicada",
      "borrador",
      "boardingpointids",
      ids.salidaA,
      ids.salidaB,
      ids.puntoNorte,
      ids.borrador,
      ids.archivado,
    ];
    for (const texto of textos) {
      const minusculas = texto.toLowerCase();
      for (const interno of internos) {
        expect(minusculas, interno).not.toContain(interno);
      }
    }
  });
});
