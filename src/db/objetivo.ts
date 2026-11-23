import type { Config } from "../lib/config";

/** Bases a las que `db:migrate` puede aplicar migraciones. `traveltech_test` queda reservada a las pruebas. */
export type ObjetivoMigracion = "private" | "demo";

export class ObjetivoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjetivoInvalidoError";
  }
}

export function parsearObjetivo(argumentos: string[]): ObjetivoMigracion {
  if (argumentos.length === 0) return "private";
  if (argumentos.length === 1 && (argumentos[0] === "private" || argumentos[0] === "demo")) {
    return argumentos[0];
  }
  throw new ObjetivoInvalidoError("Uso: bun run db:migrate [private|demo] (por defecto: private)");
}

export function urlDelObjetivo(
  config: Pick<Config, "databaseUrl" | "demoDatabaseUrl">,
  objetivo: ObjetivoMigracion,
): string {
  return objetivo === "demo" ? config.demoDatabaseUrl : config.databaseUrl;
}
