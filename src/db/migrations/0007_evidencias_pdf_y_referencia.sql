ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_content_type_check";--> statement-breakpoint
ALTER TABLE "payment_reports" ADD COLUMN "tracking_reference" text;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reports_booking_key_idx" ON "payment_reports" USING btree ("booking_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_content_type_check" CHECK ("media_assets"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_tracking_reference_check" CHECK ("payment_reports"."tracking_reference" is null or char_length("payment_reports"."tracking_reference") between 1 and 40);