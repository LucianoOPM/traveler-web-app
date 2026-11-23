CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_assets_content_type_check" CHECK ("media_assets"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "media_assets_size_check" CHECK ("media_assets"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "cover_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;