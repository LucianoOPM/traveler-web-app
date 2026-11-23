// Tipos inferidos del esquema (única fuente de verdad); otros módulos importan de aquí.
import type { boardingPoints, departureBoardingPoints, departures, packages } from "./schema";

export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;
export type PackageStatus = Package["status"];

export type Departure = typeof departures.$inferSelect;
export type NewDeparture = typeof departures.$inferInsert;
export type DepartureStatus = Departure["status"];

export type BoardingPoint = typeof boardingPoints.$inferSelect;
export type NewBoardingPoint = typeof boardingPoints.$inferInsert;

export type DepartureBoardingPoint = typeof departureBoardingPoints.$inferSelect;
export type NewDepartureBoardingPoint = typeof departureBoardingPoints.$inferInsert;
