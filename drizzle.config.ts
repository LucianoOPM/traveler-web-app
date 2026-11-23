import { defineConfig } from "drizzle-kit";

// Base privada: `bun run db:generate` y `bun run db:migrate` (drizzle-kit). `bun run` carga `.env`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
