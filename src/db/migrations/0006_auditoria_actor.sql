ALTER TABLE "audit_events" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_type" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_type_check" CHECK ("audit_events"."actor_type" in ('admin', 'comprador', 'sistema'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_check" CHECK (("audit_events"."actor_type" = 'admin') = ("audit_events"."actor_user_id" is not null));