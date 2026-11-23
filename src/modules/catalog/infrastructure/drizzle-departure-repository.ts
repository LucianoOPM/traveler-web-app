import { and, asc, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../../db/schema";
import { NotFoundError } from "../../../lib/errors";
import type { DepartureRepository, ResultadoPunto } from "../domain/departure-repository";
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

  async listByPackage(packageId: string) {
    const lista = await this.db
      .select()
      .from(departures)
      .where(eq(departures.packageId, packageId))
      .orderBy(asc(departures.startsAt));
    if (lista.length === 0) return [];
    const asignados = await this.db
      .select()
      .from(departureBoardingPoints)
      .where(
        inArray(
          departureBoardingPoints.departureId,
          lista.map((s) => s.id),
        ),
      );
    return lista.map((salida) => ({
      ...salida,
      boardingPointIds: asignados
        .filter((a) => a.departureId === salida.id)
        .map((a) => a.boardingPointId),
    }));
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
      return await this.conSalidaModificable(departureId, async (tx) => {
        const filas = await tx
          .insert(departureBoardingPoints)
          .values({ departureId, boardingPointId })
          .onConflictDoNothing()
          .returning({ id: departureBoardingPoints.departureId });
        return filas.length > 0;
      });
    } catch (error) {
      if (esErrorPg(error, "23503")) throw new NotFoundError("Punto de abordaje no encontrado");
      throw error;
    }
  }

  async removeBoardingPoint(departureId: string, boardingPointId: string) {
    return this.conSalidaModificable(departureId, async (tx) => {
      const filas = await tx
        .delete(departureBoardingPoints)
        .where(
          and(
            eq(departureBoardingPoints.departureId, departureId),
            eq(departureBoardingPoints.boardingPointId, boardingPointId),
          ),
        )
        .returning({ id: departureBoardingPoints.departureId });
      return filas.length > 0;
    });
  }

  // `FOR UPDATE` bloquea la fila de la salida hasta el commit: una cancelación concurrente espera
  // y, si llegó antes, aquí se ve `cancelada`. La FK sola no basta (su bloqueo no choca con un
  // UPDATE del estado). `escribir` devuelve si la escritura cambió algo.
  private conSalidaModificable(
    departureId: string,
    escribir: (tx: Tx) => Promise<boolean>,
  ): Promise<ResultadoPunto> {
    return this.db.transaction(async (tx) => {
      const [salida] = await tx
        .select({ status: departures.status })
        .from(departures)
        .where(eq(departures.id, departureId))
        .for("update");
      if (!salida) return "inexistente";
      if (salida.status === "cancelada") return "cancelada";
      return (await escribir(tx)) ? "ok" : "sin_cambio";
    });
  }
}

type Tx = Parameters<Parameters<BunSQLDatabase<typeof schema>["transaction"]>[0]>[0];
