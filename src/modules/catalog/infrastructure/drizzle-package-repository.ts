import { and, desc, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../../db/schema";
import { ConflictError } from "../../../lib/errors";
import type { PackageRepository } from "../domain/package-repository";
import { packages } from "../schema";
import { esErrorPg } from "./errores-pg";

export class DrizzlePackageRepository implements PackageRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  async find(id: string) {
    const [paquete] = await this.db.select().from(packages).where(eq(packages.id, id));
    return paquete ?? null;
  }

  async findByCover(assetId: string) {
    const [paquete] = await this.db
      .select()
      .from(packages)
      .where(eq(packages.coverAssetId, assetId));
    return paquete ?? null;
  }

  list() {
    return this.db.select().from(packages).orderBy(desc(packages.createdAt));
  }

  listPublished() {
    return this.db
      .select()
      .from(packages)
      .where(eq(packages.status, "publicado"))
      .orderBy(desc(packages.createdAt));
  }

  async create(datos: Parameters<PackageRepository["create"]>[0]) {
    const [paquete] = await this.db.insert(packages).values(datos).returning();
    return paquete!;
  }

  async update(
    id: string,
    esperado: Parameters<PackageRepository["update"]>[1],
    cambios: Parameters<PackageRepository["update"]>[2],
  ) {
    const [paquete] = await this.db
      .update(packages)
      .set(cambios)
      .where(and(eq(packages.id, id), eq(packages.status, esperado)))
      .returning();
    return paquete ?? null;
  }

  async delete(id: string, esperado: Parameters<PackageRepository["delete"]>[1]) {
    try {
      const filas = await this.db
        .delete(packages)
        .where(and(eq(packages.id, id), eq(packages.status, esperado)))
        .returning({ id: packages.id });
      return filas.length > 0;
    } catch (error) {
      if (esErrorPg(error, "23503")) throw new ConflictError("El paquete tiene salidas asociadas");
      throw error;
    }
  }
}
