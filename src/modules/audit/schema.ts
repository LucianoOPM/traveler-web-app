import { sql } from "drizzle-orm";
import { check, customType, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "@modules/identity/schema";

// Mismo `customType` que `payments/schema.ts`: el `jsonb` de Drizzle con bun-sql se codifica dos veces.
const jsonb = customType<{ data: Record<string, unknown>; driverData: Record<string, unknown> }>({
  dataType: () => "jsonb",
});

// Quién actúa: personal con usuario, el comprador por su token o el sistema (expiraciones). Sin usuario
// inventado: `actor_user_id` solo existe para `admin`.
export const TIPOS_ACTOR_AUDITORIA = ["admin", "comprador", "sistema"] as const;

// Append-only por convención de los servicios (sin triggers). `entity_id` no es FK: el registro
// sobrevive a la entidad eliminada. `before`/`after` los construye cada servicio con campos
// permitidos explícitos; nunca se serializa la entidad completa.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    actorType: text("actor_type", { enum: TIPOS_ACTOR_AUDITORIA }).notNull().default("admin"),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    check(
      "audit_events_actor_type_check",
      sql`${t.actorType} in ('admin', 'comprador', 'sistema')`,
    ),
    check(
      "audit_events_actor_check",
      sql`(${t.actorType} = 'admin') = (${t.actorUserId} is not null)`,
    ),
  ],
);
