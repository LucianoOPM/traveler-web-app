import type { auditEvents } from "./schema";

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
