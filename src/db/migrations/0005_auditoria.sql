CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at");