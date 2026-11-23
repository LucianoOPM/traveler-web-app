import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "@db/schema";
import { HORAS_RETENCION_POR_DEFECTO } from "@lib/config";
import { BookingService } from "./application/booking-service";
import { DrizzleBookingRepository } from "./infrastructure/drizzle-booking-repository";

/** Único sitio que conoce las clases concretas del módulo. La base la elige el servidor. */
export function crearReservas(db: BunSQLDatabase<typeof schema>) {
  // Ya validada al arrancar (`comprobarConfiguracion`); solo afecta a reservas nuevas.
  const holdHours = Number(process.env.BOOKING_HOLD_HOURS ?? HORAS_RETENCION_POR_DEFECTO);
  return { bookings: new BookingService(new DrizzleBookingRepository(db), { holdHours }) };
}
