CREATE TABLE "board_buttons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text DEFAULT 'neutral' NOT NULL,
	"steps" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_buttons_scope" CHECK ("board_buttons"."scope" in ('card', 'board')),
	CONSTRAINT "board_buttons_name_length" CHECK (char_length("board_buttons"."name") between 1 and 50),
	CONSTRAINT "board_buttons_steps_shape" CHECK (jsonb_typeof("board_buttons"."steps") = 'array' and jsonb_array_length("board_buttons"."steps") between 1 and 10 and pg_column_size("board_buttons"."steps") < 16384)
);
--> statement-breakpoint
ALTER TABLE "board_buttons" ADD CONSTRAINT "board_buttons_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_buttons" ADD CONSTRAINT "board_buttons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_buttons" ADD CONSTRAINT "board_buttons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_buttons_name_unique" ON "board_buttons" USING btree ("board_id",coalesce("user_id", '00000000-0000-0000-0000-000000000000'::uuid),"scope",lower("name"));--> statement-breakpoint
CREATE INDEX "board_buttons_user_idx" ON "board_buttons" USING btree ("user_id");