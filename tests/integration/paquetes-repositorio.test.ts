import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { ConflictError } from "@lib/errors";
import { PackageService } from "@modules/catalog/application/package-service";
import { DrizzlePackageRepository } from "@modules/catalog/infrastructure/drizzle-package-repository";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crearMedia } from "@modules/media/container";
import { jpeg, png } from "../support/imagenes";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

// En local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("repositorio de paquetes en traveltech_test", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  const repo = new DrizzlePackageRepository(db);
  const carpeta = path.join(tmpdir(), `portadas-${crypto.randomUUID()}`);
  const media = crearMedia(db, carpeta);
  const servicio = new PackageService(repo, media);
  const archivos = () => readdir(path.join(carpeta, "media")).catch(() => []);

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  });
  beforeEach(async () => {
    await sql`delete from departures`;
    await sql`delete from packages`;
    await sql`delete from media_assets`;
    await rm(carpeta, { recursive: true, force: true });
  });
  afterAll(async () => {
    await rm(carpeta, { recursive: true, force: true });
    await sql.close();
  });

  test("crea, edita, publica y archiva con las transiciones del dominio", async () => {
    const creado = await servicio.create({ name: "Cancún" });
    expect(creado).toMatchObject({ status: "borrador", summary: "", description: "" });

    await servicio.edit(creado.id, { summary: "Resumen", description: "Descripción" });
    const publicado = await servicio.publish(creado.id);
    expect(publicado.status).toBe("publicado");
    expect(publicado.updatedAt.getTime()).toBeGreaterThanOrEqual(creado.updatedAt.getTime());
    expect((await servicio.archive(creado.id)).status).toBe("archivado");
  });

  test("list devuelve primero el paquete creado más recientemente", async () => {
    const viejo = await servicio.create({ name: "Viejo" });
    await sql`update packages set created_at = created_at - interval '1 day' where id = ${viejo.id}`;
    const nuevo = await servicio.create({ name: "Nuevo" });
    expect((await servicio.list()).map((p) => p.id)).toEqual([nuevo.id, viejo.id]);
  });

  test("listPublished solo devuelve los publicados", async () => {
    const borrador = await servicio.create({ name: "Borrador" });
    const publicado = await servicio.create({ name: "Publicado", summary: "s", description: "d" });
    await servicio.publish(publicado.id);
    const archivado = await servicio.create({ name: "Archivado", summary: "s", description: "d" });
    await servicio.publish(archivado.id);
    await servicio.archive(archivado.id);
    const ids = (await repo.listPublished()).map((p) => p.id);
    expect(ids).toEqual([publicado.id]);
    expect(ids).not.toContain(borrador.id);
  });

  test("update y delete son condicionales por estado", async () => {
    const { id } = await repo.create({ name: "A", summary: "s", description: "d" });
    expect(await repo.update(id, "publicado", { name: "B" })).toBeNull();
    expect(await repo.delete(id, "publicado")).toBe(false);
    expect((await repo.find(id))?.name).toBe("A");
    expect(await repo.update(id, "borrador", { name: "B" })).toMatchObject({ name: "B" });
    expect(await repo.delete(id, "borrador")).toBe(true);
    expect(await repo.find(id)).toBeNull();
  });

  test("eliminar un borrador con salidas da 409 (violación de FK 23503)", async () => {
    const { id } = await repo.create({ name: "A", summary: "", description: "" });
    await sql`insert into departures (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents)
      values (${id}, '2027-01-10T10:00:00Z', '2027-01-12T10:00:00Z', 10, 1, 1, 0)`;
    await expect(servicio.delete(id)).rejects.toBeInstanceOf(ConflictError);
    expect(await repo.find(id)).not.toBeNull();
  });

  test("un publicado con salidas da 422 antes de llegar al DELETE", async () => {
    const { id } = await repo.create({ name: "A", summary: "s", description: "d" });
    await servicio.publish(id);
    await sql`insert into departures (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents)
      values (${id}, '2027-01-10T10:00:00Z', '2027-01-12T10:00:00Z', 10, 1, 1, 0)`;
    await expect(servicio.delete(id)).rejects.toMatchObject({ status: 422 });
  });

  test("reemplazar la portada borra el archivo y la fila anteriores; la FK impide borrar una en uso", async () => {
    const { id } = await servicio.create({ name: "Cancún" });
    const primera = (await servicio.setCover(id, jpeg())).coverAssetId!;
    expect(await archivos()).toHaveLength(1);

    const segunda = (await servicio.setCover(id, png())).coverAssetId!;
    expect(segunda).not.toBe(primera);
    expect(await archivos()).toEqual([`${segunda}.png`]);
    expect((await sql`select id from media_assets`).map((f: { id: string }) => f.id)).toEqual([
      segunda,
    ]);

    // Con el paquete apuntándole, borrar el asset directamente falla (ON DELETE restrict).
    await expect(sql`delete from media_assets where id = ${segunda}`).rejects.toThrow();
  });

  test("eliminar un borrador con portada borra su archivo y su fila", async () => {
    const { id } = await servicio.create({ name: "Cancún" });
    await servicio.setCover(id, jpeg());
    await servicio.delete(id);
    expect(await archivos()).toEqual([]);
    expect(await sql`select id from media_assets`).toHaveLength(0);
  });

  test("una imagen inválida no deja archivo ni fila", async () => {
    const { id } = await servicio.create({ name: "Cancún" });
    await expect(servicio.setCover(id, new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect(await archivos()).toEqual([]);
    expect(await sql`select id from media_assets`).toHaveLength(0);
  });
});
