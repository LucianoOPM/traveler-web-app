import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { prepararAplicacion } from "../support/aplicacion";
import { cuerpoReserva, pagina, reservar, sembrarSalida, tokenDe } from "../support/reservas";

// Checkout invitado con la app REAL (build de producción), sin sesión y con peticiones directas a
// la Action pública. Construye `dist/`: no ejecutar junto a otras pruebas que construyan.
// El límite de solicitudes (5 por hora por IP, en memoria del proceso) cuenta toda solicitud con
// forma válida: este archivo hace como máximo 5 (A, B1, B2, C y D). El límite se prueba en
// `reservas-limite.test.ts`, con su propio proceso.

const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};

describe.skipIf(!base && !process.env.CI)("checkout invitado y consulta por token", () => {
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
  });
  afterAll(() => detener());

  const filas = async () => {
    const [f] = await sql`select
      (select count(*) from bookings)::int as reservas,
      (select count(*) from booking_passengers)::int as pasajeros,
      (select count(*) from booking_events)::int as eventos`;
    return f as { reservas: number; pasajeros: number; eventos: number };
  };

  let token = "";
  let referencia = "";
  let departureId = "";

  test("A: una reserva válida devuelve el enlace una vez y solo guarda su hash", async () => {
    const s = await sembrarSalida(sql, { capacity: 10 });
    departureId = s.departureId;
    const r = await reservar(origen, cuerpoReserva(s));
    expect(r.status).toBe(200);
    token = tokenDe(r.texto);
    referencia = (JSON.parse(r.texto) as unknown[]).find(
      (v) => typeof v === "string" && /^TT-[A-Z0-9]{8}$/.test(v),
    ) as string;
    expect(referencia).toBeTruthy();
    // Total calculado por el servidor: adulto $1,500.00 + infante $0.00, en centavos.
    expect(JSON.parse(r.texto)).toContain(150000);

    const [reserva] = await sql`select access_token_hash, total_cents, status
      from bookings where reference = ${referencia}`;
    expect(reserva).toMatchObject({ total_cents: 150000, status: "pendiente" });
    expect(reserva.access_token_hash).toMatch(/^[0-9a-f]{64}$/);
    const [volcado] = await sql`select
      (select string_agg(to_jsonb(b)::text, '') from bookings b) ||
      coalesce((select string_agg(to_jsonb(p)::text, '') from booking_passengers p), '') ||
      coalesce((select string_agg(to_jsonb(e)::text, '') from booking_events e), '') as todo`;
    expect(volcado.todo).not.toContain(token);
  });

  test("la consulta por token: contenido, cabeceras y sin datos de contacto sensibles", async () => {
    const r = await pagina(origen, `/reservas/${token}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await r.text();
    expect(html).toContain(referencia);
    expect(html).toContain("Pendiente");
    expect(html).toContain("Ana Pérez");
    expect(html).toContain("Bebé Pérez");
    expect(html).toContain("$1,500.00");
    expect(html).not.toContain("5551234567");
    expect(html).not.toContain("ana@example.com");
    // Sin recursos externos que puedan filtrar la URL con el token.
    expect(html).not.toMatch(/(?:src|href)="https?:\/\//);
  });

  test("token inexistente, inválido o malformado: el mismo 404 y las mismas cabeceras", async () => {
    const falsos = [
      "A".repeat(43), // forma válida, no existe
      "abc",
      "a".repeat(44),
      "%2e%2e%2f".repeat(5),
      "<script>",
    ];
    const respuestas = await Promise.all(falsos.map((t) => pagina(origen, `/reservas/${t}`)));
    const cuerpos = await Promise.all(respuestas.map((r) => r.text()));
    for (const r of respuestas) {
      expect(r.status).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(new Set(cuerpos).size).toBe(1);
    expect(cuerpos[0]).not.toContain("TT-");
  });

  test("GET nunca escribe y una pendiente vencida se muestra expirada sin materializarse", async () => {
    await sql`update bookings set expires_at = now() - interval '1 minute' where reference = ${referencia}`;
    const antes = await sql`select status, expires_at, updated_at from bookings`;
    const antesFilas = await filas();
    for (let i = 0; i < 3; i++) {
      const html = await (await pagina(origen, `/reservas/${token}`)).text();
      expect(html).toContain("Expirada");
    }
    await pagina(origen, `/reservar/${departureId}`);
    await pagina(origen, "/");
    expect(await sql`select status, expires_at, updated_at from bookings`).toEqual(antes);
    expect(await filas()).toEqual(antesFilas);
    expect((antes[0] as { status: string }).status).toBe("pendiente");
  });

  test("datos inválidos: errores por campo, sin reflejar valores y sin filas (no cuentan en el límite)", async () => {
    const s = await sembrarSalida(sql, { capacity: 10 });
    const antes = await filas();
    const r = await reservar(
      origen,
      cuerpoReserva(s, {
        buyerName: "   ",
        buyerEmail: "valor-sospechoso-no-correo",
        passengers: [{ fullName: "Nombre-Pasajero-Secreto", fareCategory: "senior-raro" }],
      }),
    );
    expect(r.status).toBe(400);
    const error = JSON.parse(r.texto) as { fields?: Record<string, string[]> };
    expect(Object.keys(error.fields ?? {})).toEqual(
      expect.arrayContaining(["buyerName", "buyerEmail"]),
    );
    for (const eco of ["valor-sospechoso-no-correo", "Nombre-Pasajero-Secreto", "senior-raro"]) {
      expect(r.texto).not.toContain(eco);
    }
    expect(await filas()).toEqual(antes);
  });

  test("claves extra (role, demoMode, database, o dentro de un pasajero) se rechazan sin crear nada", async () => {
    const s = await sembrarSalida(sql, { capacity: 10 });
    const antes = await filas();
    for (const extra of [
      { role: "admin" },
      { demoMode: true },
      { database: "traveltech_demo" },
      { passengers: [{ fullName: "A", fareCategory: "adulto", role: "admin" }] },
      { passengers: [] },
      { passengers: Array.from({ length: 11 }, () => ({ fullName: "A", fareCategory: "adulto" })) },
      { buyerName: "x".repeat(121) },
    ]) {
      const r = await reservar(origen, cuerpoReserva(s, extra));
      expect(r.status, JSON.stringify(Object.keys(extra))).toBe(400);
    }
    expect(await filas()).toEqual(antes);
  });

  test("B: salida llena da 409 capacity_exceeded sin dejar filas", async () => {
    const s = await sembrarSalida(sql, { capacity: 2 });
    expect((await reservar(origen, cuerpoReserva(s))).status).toBe(200); // B1: 2 pasajeros
    const antes = await filas();
    const r = await reservar(origen, cuerpoReserva(s)); // B2
    expect(r.status).toBe(409);
    expect(r.texto).not.toContain("TT-");
    expect(await filas()).toEqual(antes);
  });

  test("C: un punto no asignado a la salida da 422 sin dejar filas", async () => {
    const s = await sembrarSalida(sql, { capacity: 10 });
    const ajeno = await sembrarSalida(sql, { capacity: 10 });
    const antes = await filas();
    const r = await reservar(
      origen,
      cuerpoReserva({ ...s, boardingPointId: ajeno.boardingPointId }),
    );
    expect(r.status).toBe(422);
    expect(await filas()).toEqual(antes);
  });

  test("D: una salida cancelada da 422 y su checkout responde 404", async () => {
    const s = await sembrarSalida(sql, { capacity: 10, status: "cancelada" });
    const antes = await filas();
    expect((await reservar(origen, cuerpoReserva(s))).status).toBe(422);
    expect(await filas()).toEqual(antes);
    expect((await pagina(origen, `/reservar/${s.departureId}`)).status).toBe(404);
  });

  test("página de checkout: tarifas por categoría, sin rangos de edad; 404 uniforme si no es reservable", async () => {
    const s = await sembrarSalida(sql, { capacity: 10 });
    const r = await pagina(origen, `/reservar/${s.departureId}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Adulto");
    expect(html).toContain("$1,500.00");
    expect(html).not.toMatch(/12\+|3\s*[–-]\s*11|0\s*[–-]\s*2/);

    const borrador = await sembrarSalida(sql, { capacity: 10, status: "borrador" });
    const archivado = await sembrarSalida(sql, { capacity: 10, paquete: "archivado" });
    const cuerpos = new Set<string>();
    for (const ruta of [
      "/reservar/no-es-uuid",
      "/reservar/5f1c1c0e-0000-4000-8000-0000000000ff",
      `/reservar/${borrador.departureId}`,
      `/reservar/${archivado.departureId}`,
    ]) {
      const respuesta = await pagina(origen, ruta);
      expect(respuesta.status, ruta).toBe(404);
      cuerpos.add(await respuesta.text());
    }
    expect(cuerpos.size).toBe(1);
  });

  test("el catálogo enlaza al checkout solo si hay plazas", async () => {
    const [{ id }] = await sql`select package_id as id from departures where id = ${departureId}`;
    const html = await (await pagina(origen, `/paquetes/${id}`)).text();
    expect(html).toContain(`/reservar/${departureId}`);
  });
});
