import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { crearMedia } from "@modules/media/container";
import { BoardingPointService } from "./application/boarding-point-service";
import { DepartureService } from "./application/departure-service";
import { PackageService } from "./application/package-service";
import { PublicCatalogService } from "./application/public-catalog-service";
import { DrizzleBoardingPointRepository } from "./infrastructure/drizzle-boarding-point-repository";
import { DrizzleDepartureRepository } from "./infrastructure/drizzle-departure-repository";
import { DrizzlePackageRepository } from "./infrastructure/drizzle-package-repository";

/** Único sitio que conoce las clases concretas del módulo. La base la elige el servidor. */
export function crearCatalogo(db: BunSQLDatabase<typeof schema>) {
  const packageRepo = new DrizzlePackageRepository(db);
  const departureRepo = new DrizzleDepartureRepository(db);
  const boardingPointRepo = new DrizzleBoardingPointRepository(db);
  const departures = new DepartureService(departureRepo);
  const media = crearMedia(db);
  return {
    packages: new PackageService(packageRepo, media),
    departures,
    media,
    boardingPoints: new BoardingPointService(boardingPointRepo),
    publico: new PublicCatalogService(packageRepo, departureRepo, boardingPointRepo, departures),
  };
}
