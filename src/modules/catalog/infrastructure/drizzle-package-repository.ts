import { and, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../../db/schema";
import { ConflictError } from "../../../lib/errors";
import type { PackageRepository } from "../domain/package-repository";
import { packages } from "../schema";

/** SQLSTATE `foreign_key_violation`. Bun lo expone en `errno` y Drizzle puede envolverlo en `cause`. */
function esViolacionFk(error: unknown): boolean {
  type Anidado = { errno?: unknown; code?: unknown; cause?: unknown };
  let actual = error as Anidado | undefined;
  for (let i = 0; actual && i < 3; i++) {
    if (actual.errno === "23503" || actual.code === "23503") return true;
    actual = actual.cause as Anidado | undefined;
  }
  return false;
}

export class DrizzlePackageRepository implements PackageRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  async find(id: string) {
    const [paquete] = await this.db.select().from(packages).where(eq(packages.id, id));
    return paquete ?? null;
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
      if (esViolacionFk(error)) throw new ConflictError("El paquete tiene salidas asociadas");
      throw error;
    }
  }
}
