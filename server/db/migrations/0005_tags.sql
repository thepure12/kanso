ALTER TABLE "cards" ADD CONSTRAINT "cards_id_board_id_unique" UNIQUE("id","board_id");--> statement-breakpoint
CREATE TABLE "card_tags" (
	"card_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	CONSTRAINT "card_tags_card_id_tag_id_pk" PRIMARY KEY("card_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_id_board_id_unique" UNIQUE("id","board_id"),
	CONSTRAINT "tags_board_id_name_unique" UNIQUE("board_id","name"),
	CONSTRAINT "tags_color_hex" CHECK ("tags"."color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "card_tags" ADD CONSTRAINT "card_tags_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_tags" ADD CONSTRAINT "card_tags_tag_board_fk" FOREIGN KEY ("tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;