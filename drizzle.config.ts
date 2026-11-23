import { defineConfig } from "drizzle-kit";

// Solo para `drizzle-kit generate` (db:generate). Las migraciones se aplican con `db:migrate`
// (migrador programático de bun-sql, ADR-023), por eso no hay credenciales aquí.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
