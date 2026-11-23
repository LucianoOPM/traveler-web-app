// Tipos inferidos del esquema (única fuente de verdad); otros módulos importan de aquí.
import type { bookingEvents, bookingPassengers, bookings } from "./schema";

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingStatus = Booking["status"];

export type BookingPassenger = typeof bookingPassengers.$inferSelect;
export type NewBookingPassenger = typeof bookingPassengers.$inferInsert;

export type BookingEvent = typeof bookingEvents.$inferSelect;
export type NewBookingEvent = typeof bookingEvents.$inferInsert;
