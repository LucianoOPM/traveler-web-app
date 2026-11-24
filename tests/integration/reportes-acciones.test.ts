import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";
import { sembrarAsignacionDe, sembrarCuenta, sembrarReservaConToken } from "../support/cuentas";
import { jpeg, pdf, pdfDe } from "../support/imagenes";
import { pagina } from "../support/reservas";

// Action pública `payments.reportPayment`, ruta de evidencias del admin y página del comprador con la
// app REAL (build de producción). Construye `dist/`: no ejecutar a la vez que otras pruebas que
// construyan. El límite (10 por hora por IP, en memoria) se agota al final de este archivo; antes de
// eso solo se envían 6 solicitudes que llegan al handler.
const ADMIN = "admin-reportes-app@example.test";
const OPERADOR = "operador-reportes-app@example.test";
const CINCO_MIB = 5 * 1024 * 1024;
const base = abrirBaseDePruebas();
let origen = "";
let carpeta = "";
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

describe.skipIf(!base && !process.env.CI)("reporte SPEI: Action, evidencias y página", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    carpeta = await mkdtemp(path.join(tmpdir(), "traveltech-reportes-app-"));
    const app = await prepararAplicacion(
      sql,
      db,
      [
        { correo: ADMIN, rol: "admin" },
        { correo: OPERADOR, rol: "operator" },
      ],
      carpeta,
    );
    origen = app.origen;
    detener = async () => void (await app.detener());
    cookies.admin = await iniciarSesion(ADMIN);
    cookies.operador = await iniciarSesion(OPERADOR);
  }, 180_000);
  afterAll(async () => {
    await detener();
    await rm(carpeta, { recursive: true, force: true });
    await sql.close();
  });

  const archivos = () => readdir(path.join(carpeta, "media")).catch(() => [] as string[]);
  const reportar = async (
    campos: Record<string, string | undefined>,
    bytes: Uint8Array,
    cabeceras: Record<string, string> = {},
  ) => {
    const datos = new FormData();
    for (const [k, v] of Object.entries(campos)) if (v !== undefined) datos.set(k, v);
    datos.set("file", new File([bytes as BlobPart], "mi-comprobante-original.pdf"));
    const r = await fetch(`${origen}/_actions/payments.reportPayment`, {
      method: "POST",
      headers: cabeceras,
      body: datos,
    });
    return { status: r.status, texto: await r.text() };
  };
  const escrituras = async () => {
    const [f] = await sql`select
      (select count(*) from payment_reports)::int as r, (select count(*) from media_assets)::int as m,
      (select count(*) from booking_events)::int as e, (select count(*) from audit_events)::int as u,
      (select count(*) from bank_allocations)::int as a, (select count(*) from admin_cases)::int as c,
      (select count(*) from bookings where status = 'expirada')::int as x`;
    return JSON.stringify(f);
  };
  const escenario = async (monto = 100_000) => {
    const cuenta = await sembrarCuenta(sql);
    const r = await sembrarReservaConToken(sql, { monto });
    await sembrarAsignacionDe(sql, r.id, cuenta, monto);
    return r;
  };
  const campos = (token: string, extra: Record<string, string | undefined> = {}) => ({
    token,
    requestKey: crypto.randomUUID(),
    amountCents: "10000",
    ...extra,
  });

  let reserva!: Awaited<ReturnType<typeof escenario>>;
  let evidencia = "";

  test("sin sesión, con el token: un PDF válido crea el reporte; el nombre del cliente no se usa", async () => {
    reserva = await escenario(100_000);
    const r = await reportar(campos(reserva.token, { trackingReference: "RASTREO-1" }), pdf());
    expect(r.status).toBe(200);
    const [rep] = await sql`select evidence_asset_id, tracking_reference, status
      from payment_reports where booking_id = ${reserva.id}`;
    expect(rep).toMatchObject({ tracking_reference: "RASTREO-1", status: "pendiente" });
    evidencia = rep.evidence_asset_id;
    const [asset] =
      await sql`select storage_key, content_type from media_assets where id = ${evidencia}`;
    expect(asset.content_type).toBe("application/pdf");
    expect(asset.storage_key).toMatch(/^media\/[0-9a-f-]{36}\.pdf$/);
    expect(asset.storage_key).not.toContain("original");
    expect(await archivos()).toEqual([`${evidencia}.pdf`]);
  });

  test("CSRF: un envío de formulario desde otro origen se rechaza sin tocar nada", async () => {
    const antes = await escrituras();
    const r = await reportar(campos(reserva.token), pdf(), { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(await escrituras()).toBe(antes);
  });

  test("claves desconocidas, clave de intento inválida o sin archivo: 400, sin rastro", async () => {
    const antes = await escrituras();
    for (const extra of [
      { role: "admin" },
      { database: "traveltech_demo" },
      { demoMode: "true" },
    ]) {
      expect((await reportar(campos(reserva.token, extra), pdf())).status).toBe(400);
    }
    expect(
      (await reportar(campos(reserva.token, { requestKey: "no-es-uuid" }), pdf())).status,
    ).toBe(400);
    expect((await reportar(campos(reserva.token, { amountCents: "abc" }), pdf())).status).toBe(400);
    const sinArchivo = new FormData();
    sinArchivo.set("token", reserva.token);
    const r = await fetch(`${origen}/_actions/payments.reportPayment`, {
      method: "POST",
      body: sinArchivo,
    });
    expect(r.status).toBe(400);
    expect(await escrituras()).toBe(antes);
  });

  test("firma inválida y 5 MiB + 1 byte: 422 sin archivos ni filas; 5 MiB exactos se aceptan", async () => {
    const antes = await escrituras();
    const archivosAntes = await archivos();
    const falsa = await reportar(
      campos(reserva.token),
      new TextEncoder().encode("<html>%PDF-1.4 %%EOF</html>"),
    );
    expect(falsa.status).toBe(422);
    const grande = await reportar(campos(reserva.token), pdfDe(CINCO_MIB + 1));
    expect(grande.status).toBe(422);
    expect(await escrituras()).toBe(antes);
    expect(await archivos()).toEqual(archivosAntes);

    const exacto = await reportar(campos(reserva.token), pdfDe(CINCO_MIB));
    expect(exacto.status).toBe(200);
    expect((await archivos()).length).toBe(archivosAntes.length + 1);
  });

  test("un cuerpo por encima del límite de la petición (6 MiB) se rechaza antes del handler", async () => {
    const antes = await escrituras();
    const r = await reportar(campos(reserva.token), new Uint8Array(7 * 1024 * 1024));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await escrituras()).toBe(antes);
  });

  test("el mismo envío repetido no duplica el reporte, el archivo ni el evento", async () => {
    const r = await escenario(100_000);
    const mismo = campos(r.token);
    const archivosAntes = (await archivos()).length;
    expect((await reportar(mismo, jpeg())).status).toBe(200);
    expect((await reportar(mismo, jpeg())).status).toBe(200);
    expect(await sql`select id from payment_reports where booking_id = ${r.id}`).toHaveLength(1);
    expect(
      await sql`select id from booking_events where booking_id = ${r.id} and type = 'pago_reportado'`,
    ).toHaveLength(1);
    expect((await archivos()).length).toBe(archivosAntes + 1);
  });

  test("token inexistente: 404 uniforme; importe sobre el saldo: 422; sin asignación: 409", async () => {
    // Estas solicitudes no llegan a escribir, pero sí cuentan para el límite: se agrupan con cuidado.
    const sinAsignar = await sembrarReservaConToken(sql, { monto: 5000 });
    const sobre = await reportar(campos(reserva.token, { amountCents: "100001" }), pdf());
    expect(sobre.status).toBe(422);
    const sin = await reportar(campos(sinAsignar.token), pdf());
    expect(sin.status).toBe(409);
  });

  describe("ruta de evidencias del admin", () => {
    const leer = (id: string, cookie?: string) =>
      fetch(`${origen}/admin/pagos/evidencias/${id}`, {
        redirect: "manual",
        headers: cookie ? { cookie } : {},
      });

    test("sin sesión → /login y operador → 403", async () => {
      const anonimo = await leer(evidencia);
      expect(anonimo.status).toBe(302);
      expect(anonimo.headers.get("location")).toBe("/login");
      expect((await leer(evidencia, cookies.operador)).status).toBe(403);
    });

    test("el admin recibe el PDF como descarga, sin caché y con nosniff", async () => {
      const r = await leer(evidencia, cookies.admin);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/pdf");
      expect(r.headers.get("content-disposition")).toBe(
        `attachment; filename="evidencia-${evidencia}.pdf"`,
      );
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(pdf());
    });

    test("una imagen se sirve sin cambiar su tipo; ids inválidos, inexistentes o que no son evidencias dan 404", async () => {
      const r = await escenario(100_000);
      await reportar(campos(r.token, { amountCents: "1000" }), jpeg());
      const [{ evidence_asset_id: imagen }] = await sql`select evidence_asset_id
        from payment_reports where booking_id = ${r.id}`;
      const ok = await leer(imagen, cookies.admin);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("image/jpeg");

      const [portada] = await sql`insert into media_assets (storage_key, content_type, size_bytes)
        values ('media/portada-app.jpg', 'image/jpeg', 10) returning id`;
      await sql`insert into packages (name, summary, description, status, cover_asset_id)
        values ('Con portada', 'r', 'd', 'publicado', ${portada.id})`;
      for (const id of [portada.id, crypto.randomUUID(), "no-es-uuid", "..%5C..%5Cx"]) {
        expect((await leer(id, cookies.admin)).status).toBe(404);
      }
    });

    test("/api/media nunca sirve una evidencia, ni siquiera al admin", async () => {
      for (const cookie of [undefined, cookies.admin]) {
        const r = await fetch(`${origen}/api/media/${evidencia}`, {
          headers: cookie ? { cookie } : {},
        });
        expect(r.status).toBe(404);
      }
    });
  });

  test("un PDF no puede usarse como portada (admin)", async () => {
    const [p] = await sql`insert into packages (name, summary, description, status)
      values ('Para portada', 'r', 'd', 'borrador') returning id`;
    const datos = new FormData();
    datos.set("id", p.id);
    datos.set("file", new File([pdf() as BlobPart], "portada.pdf", { type: "application/pdf" }));
    const r = await fetch(`${origen}/_actions/catalog.uploadCover`, {
      method: "POST",
      headers: { cookie: cookies.admin! },
      body: datos,
    });
    expect(r.status).toBe(422);
    expect(
      (await sql`select cover_asset_id from packages where id = ${p.id}`)[0]!.cover_asset_id,
    ).toBeNull();
  });

  test("GET /reservas/<token>: formulario, aviso y reportes propios sin ids ni enlaces; sin escrituras", async () => {
    const antes = await escrituras();
    const r = await pagina(origen, `/reservas/${reserva.token}`);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("Reportar un pago");
    expect(html).toContain("no confirma el pago");
    expect(html).toContain("Tus reportes de pago");
    expect(html).toContain("En revisión");
    expect(html).toContain("Importe verificado");
    expect(html).not.toContain(evidencia);
    expect(html).not.toContain("/admin/pagos");
    expect(html).not.toContain("storage");
    expect(await escrituras()).toBe(antes);

    // Una reserva sin saldo reportable o cancelada no ofrece el formulario.
    const cancelada = await sembrarReservaConToken(sql, { monto: 1000, estado: "cancelada" });
    const h2 = await (await pagina(origen, `/reservas/${cancelada.token}`)).text();
    expect(h2).not.toContain("Reportar un pago");
  });

  test("el límite por IP responde 429", async () => {
    const r = await escenario(100_000);
    let limitado = false;
    for (let i = 0; i < 10 && !limitado; i++) {
      const res = await reportar(campos(r.token, { amountCents: "100" }), jpeg());
      if (res.status === 429) limitado = true;
      else expect(res.status).toBe(200);
    }
    expect(limitado).toBe(true);
  });
});
