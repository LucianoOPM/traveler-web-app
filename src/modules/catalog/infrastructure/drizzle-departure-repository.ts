import { and, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../../db/schema";
import { NotFoundError } from "../../../lib/errors";
import type { DepartureRepository } from "../domain/departure-repository";
import { departureBoardingPoints, departures, packages } from "../schema";
import { esErrorPg } from "./errores-pg";

export class DrizzleDepartureRepository implements DepartureRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  async find(id: string) {
    const [salida] = await this.db.select().from(departures).where(eq(departures.id, id));
    return salida ?? null;
  }

  async findPackageStatus(packageId: string) {
    const [fila] = await this.db
      .select({ status: packages.status })
      .from(packages)
      .where(eq(packages.id, packageId));
    return fila?.status ?? null;
  }

  async create(datos: Parameters<DepartureRepository["create"]>[0]) {
    const [salida] = await this.db.insert(departures).values(datos).returning();
    return salida!;
  }

  async update(
    id: string,
    esperado: Parameters<DepartureRepository["update"]>[1],
    cambios: Parameters<DepartureRepository["update"]>[2],
  ) {
    const [salida] = await this.db
      .update(departures)
      .set(cambios)
      .where(and(eq(departures.id, id), eq(departures.status, esperado)))
      .returning();
    return salida ?? null;
  }

  async delete(id: string, esperado: Parameters<DepartureRepository["delete"]>[1]) {
    const filas = await this.db
      .delete(departures)
      .where(and(eq(departures.id, id), eq(departures.status, esperado)))
      .returning({ id: departures.id });
    return filas.length > 0;
  }

  async addBoardingPoint(departureId: string, boardingPointId: string) {
    try {
      const filas = await this.db
        .insert(departureBoardingPoints)
        .values({ departureId, boardingPointId })
        .onConflictDoNothing()
        .returning({ id: departureBoardingPoints.departureId });
      return filas.length > 0;
    } catch (error) {
      if (esErrorPg(error, "23503")) throw new NotFoundError("Punto de abordaje no encontrado");
      throw error;
    }
  }

  async removeBoardingPoint(departureId: string, boardingPointId: string) {
    const filas = await this.db
      .delete(departureBoardingPoints)
      .where(
        and(
          eq(departureBoardingPoints.departureId, departureId),
          eq(departureBoardingPoints.boardingPointId, boardingPointId),
        ),
      )
      .returning({ id: departureBoardingPoints.departureId });
    return filas.length > 0;
  }
}
