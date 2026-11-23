import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../db/schema";
import { BoardingPointService } from "./application/boarding-point-service";
import { DepartureService } from "./application/departure-service";
import { PackageService } from "./application/package-service";
import { DrizzleBoardingPointRepository } from "./infrastructure/drizzle-boarding-point-repository";
import { DrizzleDepartureRepository } from "./infrastructure/drizzle-departure-repository";
import { DrizzlePackageRepository } from "./infrastructure/drizzle-package-repository";

/** Único sitio que conoce las clases concretas del módulo. La base la elige el servidor. */
export function crearCatalogo(db: BunSQLDatabase<typeof schema>) {
  return {
    packages: new PackageService(new DrizzlePackageRepository(db)),
    departures: new DepartureService(new DrizzleDepartureRepository(db)),
    boardingPoints: new BoardingPointService(new DrizzleBoardingPointRepository(db)),
  };
}
