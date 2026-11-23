import { relations } from "drizzle-orm";
import { boardingPoints, departures } from "@modules/catalog/schema";
import { user } from "@modules/identity/schema";
import { bookingEvents, bookingPassengers, bookings } from "./schema";

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  departure: one(departures, { fields: [bookings.departureId], references: [departures.id] }),
  boardingPoint: one(boardingPoints, {
    fields: [bookings.boardingPointId],
    references: [boardingPoints.id],
  }),
  passengers: many(bookingPassengers),
  events: many(bookingEvents),
}));

export const bookingPassengersRelations = relations(bookingPassengers, ({ one }) => ({
  booking: one(bookings, { fields: [bookingPassengers.bookingId], references: [bookings.id] }),
}));

export const bookingEventsRelations = relations(bookingEvents, ({ one }) => ({
  booking: one(bookings, { fields: [bookingEvents.bookingId], references: [bookings.id] }),
  actor: one(user, { fields: [bookingEvents.actorUserId], references: [user.id] }),
}));
