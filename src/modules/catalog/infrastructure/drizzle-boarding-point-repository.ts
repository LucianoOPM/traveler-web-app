import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../../db/schema";
import { ConflictError } from "../../../lib/errors";
import type { BoardingPointRepository } from "../domain/boarding-point-repository";
import { boardingPoints } from "../schema";
import { esErrorPg } from "./errores-pg";

const nombreRepetido = () => new ConflictError("Ya existe un punto de abordaje con ese nombre");

export class DrizzleBoardingPointRepository implements BoardingPointRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  async create(name: string) {
    try {
      const [punto] = await this.db.insert(boardingPoints).values({ name }).returning();
      return punto!;
    } catch (error) {
      if (esErrorPg(error, "23505")) throw nombreRepetido();
      throw error;
    }
  }

  async update(id: string, name: string) {
    try {
      const [punto] = await this.db
        .update(boardingPoints)
        .set({ name })
        .where(eq(boardingPoints.id, id))
        .returning();
      return punto ?? null;
    } catch (error) {
      if (esErrorPg(error, "23505")) throw nombreRepetido();
      throw error;
    }
  }

  async delete(id: string) {
    try {
      const filas = await this.db
        .delete(boardingPoints)
        .where(eq(boardingPoints.id, id))
        .returning({ id: boardingPoints.id });
      return filas.length > 0;
    } catch (error) {
      if (esErrorPg(error, "23503")) {
        throw new ConflictError("El punto de abordaje está asignado a una salida");
      }
      throw error;
    }
  }
}
