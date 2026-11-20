ALTER TABLE "users" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bot_board_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_board_id_boards_id_fk" FOREIGN KEY ("bot_board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_bot_board_idx" ON "users" USING btree ("bot_board_id") WHERE "users"."bot_board_id" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_board" CHECK ("users"."is_bot" = ("users"."bot_board_id" is not null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_email" CHECK (not "users"."is_bot" or "users"."email" like 'bot-%@bots.invalid');