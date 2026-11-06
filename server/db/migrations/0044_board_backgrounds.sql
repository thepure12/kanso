CREATE TABLE "board_backgrounds" (
	"board_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_backgrounds_type" CHECK ("board_backgrounds"."content_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "board_backgrounds_size" CHECK ("board_backgrounds"."size" between 1 and 5242880 and octet_length("board_backgrounds"."data") = "board_backgrounds"."size")
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "background" jsonb;--> statement-breakpoint
ALTER TABLE "board_backgrounds" ADD CONSTRAINT "board_backgrounds_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_background_shape" CHECK ("boards"."background" is null
    or ("boards"."background"->>'kind' = 'color' and "boards"."background"->>'value' ~ '^#[0-9a-f]{6}$')
    or ("boards"."background"->>'kind' in ('gradient', 'photo', 'upload') and "boards"."background"->>'value' ~ '^[a-z0-9-]{1,40}$'));