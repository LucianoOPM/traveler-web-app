import { defineConfig } from "drizzle-kit";

// `bun run db:generate` y `bun run db:migrate` usan la base privada; `bun run db:migrate:demo`
// (BASE=demo) aplica las mismas migraciones a la demo. `bun run` carga `.env`.
const url = process.env.BASE === "demo" ? process.env.DEMO_DATABASE_URL : process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: url! },
});
