CREATE TABLE "custom_view_backgrounds" (
	"view_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_view_backgrounds_type" CHECK ("custom_view_backgrounds"."content_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "custom_view_backgrounds_size" CHECK ("custom_view_backgrounds"."size" between 1 and 5242880 and octet_length("custom_view_backgrounds"."data") = "custom_view_backgrounds"."size")
);
--> statement-breakpoint
ALTER TABLE "custom_views" ADD COLUMN "background" jsonb;--> statement-breakpoint
ALTER TABLE "custom_views" ADD COLUMN "accent" text;--> statement-breakpoint
ALTER TABLE "custom_views" ADD COLUMN "column_outline" jsonb;--> statement-breakpoint
ALTER TABLE "custom_view_backgrounds" ADD CONSTRAINT "custom_view_backgrounds_view_id_custom_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."custom_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_views" ADD CONSTRAINT "custom_views_background_shape" CHECK ("custom_views"."background" is null
    or ("custom_views"."background"->>'kind' = 'color' and "custom_views"."background"->>'value' ~ '^#[0-9a-f]{6}$')
    or ("custom_views"."background"->>'kind' in ('gradient', 'photo', 'upload') and "custom_views"."background"->>'value' ~ '^[a-z0-9-]{1,40}$'));--> statement-breakpoint
ALTER TABLE "custom_views" ADD CONSTRAINT "custom_views_accent_known" CHECK ("custom_views"."accent" is null or "custom_views"."accent" in ('red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'));--> statement-breakpoint
ALTER TABLE "custom_views" ADD CONSTRAINT "custom_views_column_outline_shape" CHECK ("custom_views"."column_outline" is null or (
    jsonb_typeof("custom_views"."column_outline") = 'object'
    and "custom_views"."column_outline" ?& array['color', 'width', 'glow']
    and "custom_views"."column_outline" - 'color' - 'width' - 'glow' = '{}'::jsonb
    and ("custom_views"."column_outline"->'color' = 'null'::jsonb or "custom_views"."column_outline"->>'color' in ('accent', 'column') or "custom_views"."column_outline"->>'color' ~ '^#[0-9a-f]{6}$')
    and "custom_views"."column_outline"->'width' in ('1', '2', '3', '4')
    and "custom_views"."column_outline"->'glow' in ('0', '1', '2', '3')));