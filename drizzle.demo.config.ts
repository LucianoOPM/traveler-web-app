import { defineConfig } from "drizzle-kit";

// Base demo: `bun run db:migrate:demo`. Mismas migraciones y esquema que la privada (REC-001);
// en H1 la demo solo recibe migraciones (su uso funcional llega en H7).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DEMO_DATABASE_URL! },
});
