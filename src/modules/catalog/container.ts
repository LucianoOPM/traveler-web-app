import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../db/schema";
import { PackageService } from "./application/package-service";
import { DrizzlePackageRepository } from "./infrastructure/drizzle-package-repository";

/** Único sitio que conoce las clases concretas del módulo. La base la elige el servidor. */
export function crearCatalogo(db: BunSQLDatabase<typeof schema>) {
  return { packages: new PackageService(new DrizzlePackageRepository(db)) };
}
