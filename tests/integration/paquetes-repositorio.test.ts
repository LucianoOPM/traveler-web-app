import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { ConflictError } from "../../src/lib/errors";
import { PackageService } from "../../src/modules/catalog/application/package-service";
import { DrizzlePackageRepository } from "../../src/modules/catalog/infrastructure/drizzle-package-repository";
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
  const servicio = new PackageService(repo);

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  });
  beforeEach(async () => {
    await sql`delete from departures`;
    await sql`delete from packages`;
  });
  afterAll(() => sql.close());

  test("crea, edita, publica y archiva con las transiciones del dominio", async () => {
    const creado = await servicio.create({ name: "Cancún" });
    expect(creado).toMatchObject({ status: "borrador", summary: "", description: "" });

    await servicio.edit(creado.id, { summary: "Resumen", description: "Descripción" });
    const publicado = await servicio.publish(creado.id);
    expect(publicado.status).toBe("publicado");
    expect(publicado.updatedAt.getTime()).toBeGreaterThanOrEqual(creado.updatedAt.getTime());
    expect((await servicio.archive(creado.id)).status).toBe("archivado");
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
});
