CREATE TABLE "admin_cases" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'abierto' NOT NULL,
	"note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_cases_type_check" CHECK ("admin_cases"."type" in ('sin_cuenta_elegible', 'cancelada_con_pago_verificado')),
	CONSTRAINT "admin_cases_status_check" CHECK ("admin_cases"."status" in ('abierto', 'resuelto')),
	CONSTRAINT "admin_cases_resolved_check" CHECK (("admin_cases"."status" = 'resuelto') = ("admin_cases"."resolved_at" is not null)),
	CONSTRAINT "admin_cases_resolver_check" CHECK (("admin_cases"."resolved_at" is null) = ("admin_cases"."resolved_by" is null))
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_holder" text NOT NULL,
	"clabe" text NOT NULL,
	"priority" integer NOT NULL,
	"monthly_limit_cents" integer NOT NULL,
	"is_eligible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_monthly_limit_check" CHECK ("bank_accounts"."monthly_limit_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "bank_allocations" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"calendar_month" text NOT NULL,
	"status" text DEFAULT 'vigente' NOT NULL,
	"instruction_snapshot" jsonb NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_allocations_amount_check" CHECK ("bank_allocations"."amount_cents" > 0),
	CONSTRAINT "bank_allocations_month_check" CHECK ("bank_allocations"."calendar_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "bank_allocations_status_check" CHECK ("bank_allocations"."status" in ('vigente', 'liberada')),
	CONSTRAINT "bank_allocations_released_check" CHECK (("bank_allocations"."status" = 'liberada') = ("bank_allocations"."released_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "cash_payments" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"recorded_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_payments_amount_check" CHECK ("cash_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_reports" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"bank_allocation_id" uuid NOT NULL,
	"reported_amount_cents" integer NOT NULL,
	"evidence_asset_id" uuid NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"replaces_report_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reports_replaces_report_id_unique" UNIQUE("replaces_report_id"),
	CONSTRAINT "payment_reports_amount_check" CHECK ("payment_reports"."reported_amount_cents" > 0),
	CONSTRAINT "payment_reports_status_check" CHECK ("payment_reports"."status" in ('pendiente', 'verificado', 'rechazado', 'reemplazado'))
);
--> statement-breakpoint
CREATE TABLE "payment_reviews" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"payment_report_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"verified_amount_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reviews_payment_report_id_unique" UNIQUE("payment_report_id"),
	CONSTRAINT "payment_reviews_decision_check" CHECK ("payment_reviews"."decision" in ('verificado', 'rechazado')),
	CONSTRAINT "payment_reviews_amount_check" CHECK (("payment_reviews"."decision" = 'verificado' and "payment_reviews"."verified_amount_cents" is not null and "payment_reviews"."verified_amount_cents" > 0)
        or ("payment_reviews"."decision" = 'rechazado' and "payment_reviews"."verified_amount_cents" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_type_check";--> statement-breakpoint
ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_from_status_check";--> statement-breakpoint
ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_to_status_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";--> statement-breakpoint
ALTER TABLE "admin_cases" ADD CONSTRAINT "admin_cases_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_cases" ADD CONSTRAINT "admin_cases_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_allocations" ADD CONSTRAINT "bank_allocations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_allocations" ADD CONSTRAINT "bank_allocations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_payments" ADD CONSTRAINT "cash_payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_payments" ADD CONSTRAINT "cash_payments_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_bank_allocation_id_bank_allocations_id_fk" FOREIGN KEY ("bank_allocation_id") REFERENCES "public"."bank_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_evidence_asset_id_media_assets_id_fk" FOREIGN KEY ("evidence_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_replaces_report_id_payment_reports_id_fk" FOREIGN KEY ("replaces_report_id") REFERENCES "public"."payment_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_payment_report_id_payment_reports_id_fk" FOREIGN KEY ("payment_report_id") REFERENCES "public"."payment_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_cases_booking_id_idx" ON "admin_cases" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_allocations_booking_vigente_idx" ON "bank_allocations" USING btree ("booking_id") WHERE "bank_allocations"."status" = 'vigente';--> statement-breakpoint
CREATE INDEX "bank_allocations_account_month_status_idx" ON "bank_allocations" USING btree ("bank_account_id","calendar_month","status");--> statement-breakpoint
CREATE INDEX "cash_payments_booking_id_idx" ON "cash_payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payment_reports_booking_id_status_idx" ON "payment_reports" USING btree ("booking_id","status");--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_type_check" CHECK ("booking_events"."type" in ('creada', 'expirada', 'cancelada', 'reactivada', 'token_regenerado', 'pago_reportado', 'pago_verificado', 'pago_rechazado', 'pago_reemplazado', 'pago_efectivo', 'cuenta_asignada', 'cuenta_liberada'));--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_from_status_check" CHECK ("booking_events"."from_status" in ('pendiente', 'en_revision', 'parcial', 'pagada', 'expirada', 'cancelada'));--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_to_status_check" CHECK ("booking_events"."to_status" in ('pendiente', 'en_revision', 'parcial', 'pagada', 'expirada', 'cancelada'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('pendiente', 'en_revision', 'parcial', 'pagada', 'expirada', 'cancelada'));