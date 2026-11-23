import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { TIPOS_IMAGEN } from "./domain/firma";

// Archivo privado (hoy solo portadas de paquete; marketing lo reutilizará en H6). El nombre real
// en disco es `storage_key`, generado por el servidor; el del cliente no se guarda.
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type", { enum: TIPOS_IMAGEN }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "media_assets_content_type_check",
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("media_assets_size_check", sql`${t.sizeBytes} > 0`),
  ],
);
