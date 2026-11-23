CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_events_type_check" CHECK ("booking_events"."type" in ('creada', 'expirada', 'cancelada', 'reactivada', 'token_regenerado')),
	CONSTRAINT "booking_events_actor_type_check" CHECK ("booking_events"."actor_type" in ('comprador', 'admin', 'sistema')),
	CONSTRAINT "booking_events_actor_check" CHECK (("booking_events"."actor_type" = 'admin') = ("booking_events"."actor_user_id" is not null)),
	CONSTRAINT "booking_events_from_status_check" CHECK ("booking_events"."from_status" in ('pendiente', 'en_revision', 'expirada', 'cancelada')),
	CONSTRAINT "booking_events_to_status_check" CHECK ("booking_events"."to_status" in ('pendiente', 'en_revision', 'expirada', 'cancelada')),
	CONSTRAINT "booking_events_token_check" CHECK ("booking_events"."type" <> 'token_regenerado' or "booking_events"."to_status" is null)
);
--> statement-breakpoint
CREATE TABLE "booking_passengers" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"fare_category" text NOT NULL,
	"price_snapshot_cents" integer NOT NULL,
	CONSTRAINT "booking_passengers_fare_category_check" CHECK ("booking_passengers"."fare_category" in ('adulto', 'menor', 'infante')),
	CONSTRAINT "booking_passengers_price_check" CHECK ("booking_passengers"."price_snapshot_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"departure_id" uuid NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_phone" text NOT NULL,
	"buyer_email" text NOT NULL,
	"boarding_point_id" uuid NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"total_cents" integer NOT NULL,
	"access_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference"),
	CONSTRAINT "bookings_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('pendiente', 'en_revision', 'expirada', 'cancelada')),
	CONSTRAINT "bookings_total_check" CHECK ("bookings"."total_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_id_departures_id_fk" FOREIGN KEY ("departure_id") REFERENCES "public"."departures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_boarding_point_id_boarding_points_id_fk" FOREIGN KEY ("boarding_point_id") REFERENCES "public"."boarding_points"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_departure_id_status_idx" ON "bookings" USING btree ("departure_id","status");--> statement-breakpoint
CREATE INDEX "bookings_expires_at_status_idx" ON "bookings" USING btree ("expires_at","status");