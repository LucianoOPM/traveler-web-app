CREATE TABLE "boarding_points" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_points_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "departure_boarding_points" (
	"departure_id" uuid NOT NULL,
	"boarding_point_id" uuid NOT NULL,
	CONSTRAINT "departure_boarding_points_departure_id_boarding_point_id_pk" PRIMARY KEY("departure_id","boarding_point_id")
);
--> statement-breakpoint
CREATE TABLE "departures" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"adult_price_cents" integer NOT NULL,
	"child_price_cents" integer NOT NULL,
	"infant_price_cents" integer NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departures_capacity_check" CHECK ("departures"."capacity" >= 0),
	CONSTRAINT "departures_prices_check" CHECK ("departures"."adult_price_cents" >= 0 and "departures"."child_price_cents" >= 0 and "departures"."infant_price_cents" >= 0),
	CONSTRAINT "departures_dates_check" CHECK ("departures"."ends_at" > "departures"."starts_at"),
	CONSTRAINT "departures_status_check" CHECK ("departures"."status" in ('borrador', 'publicada', 'cancelada'))
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_status_check" CHECK ("packages"."status" in ('borrador', 'publicado', 'archivado'))
);
--> statement-breakpoint
ALTER TABLE "departure_boarding_points" ADD CONSTRAINT "departure_boarding_points_departure_id_departures_id_fk" FOREIGN KEY ("departure_id") REFERENCES "public"."departures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departure_boarding_points" ADD CONSTRAINT "departure_boarding_points_boarding_point_id_boarding_points_id_fk" FOREIGN KEY ("boarding_point_id") REFERENCES "public"."boarding_points"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departures" ADD CONSTRAINT "departures_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departures_package_id_starts_at_idx" ON "departures" USING btree ("package_id","starts_at");