ALTER TABLE "columns" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "columns" ADD CONSTRAINT "columns_color_hex" CHECK ("columns"."color" ~ '^#[0-9a-f]{6}$');