import { and, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import {
  boardingPoints,
  departureBoardingPoints,
  departures,
  packages,
} from "@modules/catalog/schema";
import type { BookingRepository, BookingTx } from "../domain/booking-repository";
import { bookingEvents, bookingPassengers, bookings } from "../schema";
import { reservasCandidatas } from "./reservas-retenidas";

type Tx = Parameters<Parameters<BunSQLDatabase<typeof schema>["transaction"]>[0]>[0];

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  async findByTokenHash(hash: string) {
    const [fila] = await this.db
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        expiresAt: bookings.expiresAt,
        totalCents: bookings.totalCents,
        buyerName: bookings.buyerName,
        packageName: packages.name,
        startsAt: departures.startsAt,
        endsAt: departures.endsAt,
        boardingPointName: boardingPoints.name,
      })
      .from(bookings)
      .innerJoin(departures, eq(departures.id, bookings.departureId))
      .innerJoin(packages, eq(packages.id, departures.packageId))
      .innerJoin(boardingPoints, eq(boardingPoints.id, bookings.boardingPointId))
      .where(eq(bookings.accessTokenHash, hash));
    if (!fila) return null;
    const { id, ...reserva } = fila;
    const passengers = await this.db
      .select({
        fullName: bookingPassengers.fullName,
        fareCategory: bookingPassengers.fareCategory,
        priceSnapshotCents: bookingPassengers.priceSnapshotCents,
      })
      .from(bookingPassengers)
      .where(eq(bookingPassengers.bookingId, id));
    return { ...reserva, passengers };
  }

  transaction<T>(fn: (tx: BookingTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(operaciones(tx)));
  }
}

const operaciones = (tx: Tx): BookingTx => ({
  async bloquearSalida(id) {
    // `of: departures`: bloquea solo la salida, no la fila del paquete que se une para leer su estado.
    const [fila] = await tx
      .select({ salida: departures, packageStatus: packages.status })
      .from(departures)
      .innerJoin(packages, eq(packages.id, departures.packageId))
      .where(eq(departures.id, id))
      .for("update", { of: departures });
    return fila ? { ...fila.salida, packageStatus: fila.packageStatus } : null;
  },

  async puntoAsignado(departureId, boardingPointId) {
    const filas = await tx
      .select({ id: departureBoardingPoints.departureId })
      .from(departureBoardingPoints)
      .where(
        and(
          eq(departureBoardingPoints.departureId, departureId),
          eq(departureBoardingPoints.boardingPointId, boardingPointId),
        ),
      );
    return filas.length > 0;
  },

  reservasCandidatas: (departureId) => reservasCandidatas(tx, departureId),

  async insertarReserva(datos) {
    const [fila] = await tx.insert(bookings).values(datos).onConflictDoNothing().returning();
    return fila ?? null;
  },

  async insertarPasajeros(datos) {
    await tx.insert(bookingPassengers).values(datos);
  },

  async insertarEvento(datos) {
    await tx.insert(bookingEvents).values(datos);
  },
});
