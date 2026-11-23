import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";
import { jpeg, jpegDe, png, webp } from "../support/imagenes";

// Portadas con la app REAL (build de producción) y un directorio de archivos temporal: subida
// validada, lectura por el controlador y visibilidad. Construye `dist/`: no ejecutar a la vez que
// otras pruebas que construyan. Solo 2 inicios de sesión (el límite de Better Auth es 3 por 10 s).

const ADMIN = "admin-imagenes@example.test";
const OPERADOR = "operador-imagenes@example.test";
const MIB = 1024 * 1024;
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

// Sin cabecera `Origin` (como un cliente que no es navegador): Astro solo rechaza los POST de
// formulario cuyo `Origin` no coincide con el del servidor.
const subir = async (
  id: string,
  bytes: Uint8Array,
  { cookie, nombre = "portada.jpg", tipo = "image/jpeg" }: Record<string, string | undefined> = {},
) => {
  const datos = new FormData();
  datos.set("id", id);
  datos.set("file", new File([bytes as BlobPart], nombre, { type: tipo }));
  const respuesta = await fetch(`${origen}/_actions/catalog.uploadCover`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: datos,
  });
  return { status: respuesta.status, texto: await respuesta.text() };
};

const leer = (ruta: string, cookie?: string) =>
  fetch(`${origen}${ruta}`, { headers: cookie ? { cookie } : {} });
const archivos = () => readdir(path.join(carpeta, "media")).catch(() => [] as string[]);

describe.skipIf(!base && !process.env.CI)("imágenes de paquetes", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    carpeta = await mkdtemp(path.join(tmpdir(), "traveltech-imagenes-"));
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

  const crearPaquete = async (nombre: string, estado = "borrador") => {
    const [fila] = await sql`insert into packages (name, summary, description, status)
      values (${nombre}, 'Resumen', 'Descripción', ${estado}) returning id`;
    return fila.id as string;
  };
  const portada = async (id: string) =>
    (await sql`select cover_asset_id from packages where id = ${id}`)[0]?.cover_asset_id as
      string | null;
  const filas = async () =>
    (await sql`select count(*)::int as n from media_assets`)[0]!.n as number;

  describe("subida", () => {
    test("sin sesión → 401 y operador → 403, sin guardar nada", async () => {
      const id = await crearPaquete("Permisos");
      expect((await subir(id, jpeg())).status).toBe(401);
      expect((await subir(id, jpeg(), { cookie: cookies.operador })).status).toBe(403);
      expect(await portada(id)).toBeNull();
      expect(await archivos()).toEqual([]);
      expect(await filas()).toBe(0);
    });

    test("el admin sube una portada válida; el nombre del cliente no se usa", async () => {
      const id = await crearPaquete("Válida");
      const respuesta = await subir(id, jpeg(), {
        cookie: cookies.admin,
        nombre: "../../evil.php",
      });
      expect(respuesta.status).toBe(200);
      const asset = await portada(id);
      expect(asset).not.toBeNull();
      const [fila] = await sql`select storage_key, content_type, size_bytes from media_assets
        where id = ${asset}`;
      expect(fila).toMatchObject({
        storage_key: `media/${asset}.jpg`,
        content_type: "image/jpeg",
        size_bytes: jpeg().length,
      });
      expect(await archivos()).toContain(`${asset}.jpg`);
      expect(await archivos()).not.toContain("evil.php");
    });

    test("el tipo sale de la firma: HTML con extensión y tipo de imagen → 422", async () => {
      const id = await crearPaquete("Falso");
      const html = new TextEncoder().encode("<html><script>1</script></html>");
      const respuesta = await subir(id, html, { cookie: cookies.admin, nombre: "a.jpg" });
      expect(respuesta.status).toBe(422);
      expect(await portada(id)).toBeNull();
    });

    test("un png real con extensión y tipo declarados ajenos se acepta como png", async () => {
      const id = await crearPaquete("Png disfrazado");
      const respuesta = await subir(id, png(), {
        cookie: cookies.admin,
        nombre: "a.pdf",
        tipo: "application/pdf",
      });
      expect(respuesta.status).toBe(200);
      expect(await archivos()).toContain(`${await portada(id)}.png`);
    });

    test("vacío → 422 sin guardar", async () => {
      const id = await crearPaquete("Vacío");
      const antes = await archivos();
      const respuesta = await subir(id, new Uint8Array(), { cookie: cookies.admin });
      expect(respuesta.status).toBe(422);
      expect(await portada(id)).toBeNull();
      expect(await archivos()).toEqual(antes);
    });

    test("corrupto (firma válida pero truncado) → 422", async () => {
      const id = await crearPaquete("Corrupto");
      const respuesta = await subir(id, jpeg().slice(0, 6), { cookie: cookies.admin });
      expect(respuesta.status).toBe(422);
      expect(await portada(id)).toBeNull();
    });

    test("más de 5 MiB llega al servicio y da 422; 5 MiB exactos se aceptan", async () => {
      const id = await crearPaquete("Grande");
      const antes = await archivos();
      expect((await subir(id, jpegDe(5 * MIB + 1), { cookie: cookies.admin })).status).toBe(422);
      expect(await archivos()).toEqual(antes);
      expect((await subir(id, jpegDe(5 * MIB), { cookie: cookies.admin })).status).toBe(200);
    });

    test("más de 6 MiB lo corta el límite de cuerpo de Astro, sin guardar nada", async () => {
      const id = await crearPaquete("Enorme");
      const antes = await archivos();
      const respuesta = await subir(id, jpegDe(7 * MIB), { cookie: cookies.admin });
      expect(respuesta.status).toBe(413);
      expect(await portada(id)).toBeNull();
      expect(await archivos()).toEqual(antes);
    });

    test("un paquete archivado no admite portada (422) y uno inexistente da 404", async () => {
      const id = await crearPaquete("Archivado", "archivado");
      expect((await subir(id, jpeg(), { cookie: cookies.admin })).status).toBe(422);
      const inexistente = "5f1c1c0e-0000-4000-8000-0000000000ff";
      expect((await subir(inexistente, jpeg(), { cookie: cookies.admin })).status).toBe(404);
    });

    test("reemplazar la portada borra el archivo y la fila anteriores", async () => {
      const id = await crearPaquete("Reemplazo");
      await subir(id, jpeg(), { cookie: cookies.admin });
      const primera = (await portada(id))!;
      expect((await subir(id, webp(), { cookie: cookies.admin })).status).toBe(200);
      const segunda = (await portada(id))!;
      expect(segunda).not.toBe(primera);
      expect(await archivos()).not.toContain(`${primera}.jpg`);
      expect(await archivos()).toContain(`${segunda}.webp`);
      expect(await sql`select 1 from media_assets where id = ${primera}`).toHaveLength(0);
    });

    test("eliminar un borrador con portada borra su archivo", async () => {
      const id = await crearPaquete("Borrar");
      await subir(id, png(), { cookie: cookies.admin });
      const asset = (await portada(id))!;
      const respuesta = await fetch(`${origen}/_actions/catalog.deletePackage`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookies.admin! },
        body: JSON.stringify({ id }),
      });
      expect(respuesta.status).toBe(200);
      expect(await archivos()).not.toContain(`${asset}.png`);
      expect(await sql`select 1 from media_assets where id = ${asset}`).toHaveLength(0);
    });
  });

  describe("lectura", () => {
    test("portada de un paquete publicado: pública, con cabeceras y bytes exactos", async () => {
      const id = await crearPaquete("Pública", "publicado");
      await subir(id, png(), { cookie: cookies.admin });
      const respuesta = await leer(`/api/media/${await portada(id)}`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get("content-type")).toBe("image/png");
      expect(respuesta.headers.get("x-content-type-options")).toBe("nosniff");
      expect(respuesta.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect(new Uint8Array(await respuesta.arrayBuffer())).toEqual(png());
    });

    test("portada de un borrador: sin sesión y operador → 404; admin → 200 sin caché", async () => {
      const id = await crearPaquete("Oculta");
      await subir(id, jpeg(), { cookie: cookies.admin });
      const ruta = `/api/media/${await portada(id)}`;
      expect((await leer(ruta)).status).toBe(404);
      expect((await leer(ruta, cookies.operador)).status).toBe(404);
      const admin = await leer(ruta, cookies.admin);
      expect(admin.status).toBe(200);
      expect(admin.headers.get("cache-control")).toBe("no-store");
      expect(admin.headers.get("x-content-type-options")).toBe("nosniff");
    });

    test("al archivar el paquete la portada deja de ser pública", async () => {
      const id = await crearPaquete("Se archiva", "publicado");
      await subir(id, jpeg(), { cookie: cookies.admin });
      const ruta = `/api/media/${await portada(id)}`;
      expect((await leer(ruta)).status).toBe(200);
      await sql`update packages set status = 'archivado' where id = ${id}`;
      expect((await leer(ruta)).status).toBe(404);
    });

    test("ids inválidos, inexistentes y recorridos de ruta → 404 sin filtrar nada", async () => {
      const rutas = [
        "/api/media/no-es-uuid",
        "/api/media/5f1c1c0e-0000-4000-8000-0000000000ff",
        "/api/media/..%2F..%2F..%2Fpackage.json",
        "/api/media/%2e%2e%2f%2e%2e%2fpackage.json",
        "/api/media/..%5C..%5Cpackage.json",
        "/api/media/media%2Fx.jpg",
      ];
      for (const ruta of rutas) {
        for (const cookie of [undefined, cookies.admin]) {
          const respuesta = await leer(ruta, cookie);
          expect(respuesta.status, ruta).toBe(404);
          expect(await respuesta.text()).not.toMatch(/storage|traveltech-imagenes|\.jpg|"name"/);
        }
      }
    });

    test("un asset que no es portada de ningún paquete no se sirve, ni al admin", async () => {
      const id = await crearPaquete("Con portada", "publicado");
      await subir(id, jpeg(), { cookie: cookies.admin });
      const asset = (await portada(id))!;
      await sql`update packages set cover_asset_id = null where id = ${id}`;
      expect((await leer(`/api/media/${asset}`, cookies.admin)).status).toBe(404);
    });
  });

  describe("pantallas", () => {
    test("catálogo público y detalle muestran la portada con texto alternativo; el borrador no se lista", async () => {
      const id = await crearPaquete("Portada visible", "publicado");
      await subir(id, jpeg(), { cookie: cookies.admin });
      const url = `/api/media/${await portada(id)}`;
      for (const ruta of ["/", `/paquetes/${id}`]) {
        const html = await (await leer(ruta)).text();
        expect(html).toContain(`src="${url}"`);
        expect(html).toContain('alt="Portada de Portada visible"');
        expect(html).not.toMatch(/storage_key|media\/[0-9a-f-]+\.jpg/);
      }
    });

    test("el panel del admin muestra la portada y el formulario de subida", async () => {
      const id = await crearPaquete("Panel");
      await subir(id, jpeg(), { cookie: cookies.admin });
      const html = await (await leer(`/admin/catalogo/${id}`, cookies.admin)).text();
      expect(html).toContain(`src="/api/media/${await portada(id)}"`);
      expect(html).toContain('alt="Portada de Panel"');
      expect(html).toContain("astro-island"); // PortadaForm hidratado
    });
  });
});
