import { relations } from "drizzle-orm";
import { boardingPoints, departureBoardingPoints, departures, packages } from "./schema";

export const packagesRelations = relations(packages, ({ many }) => ({
  departures: many(departures),
}));

export const departuresRelations = relations(departures, ({ one, many }) => ({
  package: one(packages, { fields: [departures.packageId], references: [packages.id] }),
  boardingPoints: many(departureBoardingPoints),
}));

export const boardingPointsRelations = relations(boardingPoints, ({ many }) => ({
  departures: many(departureBoardingPoints),
}));

export const departureBoardingPointsRelations = relations(departureBoardingPoints, ({ one }) => ({
  departure: one(departures, {
    fields: [departureBoardingPoints.departureId],
    references: [departures.id],
  }),
  boardingPoint: one(boardingPoints, {
    fields: [departureBoardingPoints.boardingPointId],
    references: [boardingPoints.id],
  }),
}));
