CREATE TYPE "public"."board_field_kind" AS ENUM('text', 'number', 'date', 'select', 'checkbox', 'url');--> statement-breakpoint
CREATE TABLE "board_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "board_field_kind" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" double precision NOT NULL,
	"show_on_card" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_fields_id_board_id_unique" UNIQUE("id","board_id"),
	CONSTRAINT "board_fields_name_length" CHECK (char_length("board_fields"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "card_field_values" (
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_field_values_card_id_field_id_pk" PRIMARY KEY("card_id","field_id")
);
--> statement-breakpoint
ALTER TABLE "board_fields" ADD CONSTRAINT "board_fields_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_field_values" ADD CONSTRAINT "card_field_values_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_field_values" ADD CONSTRAINT "card_field_values_field_board_fk" FOREIGN KEY ("field_id","board_id") REFERENCES "public"."board_fields"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_fields_board_name_unique" ON "board_fields" USING btree ("board_id",lower("name"));--> statement-breakpoint
CREATE INDEX "card_field_values_field_idx" ON "card_field_values" USING btree ("field_id");