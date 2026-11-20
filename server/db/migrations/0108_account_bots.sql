ALTER TABLE "users" DROP CONSTRAINT "users_bot_scope";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bot_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_owner_id_users_id_fk" FOREIGN KEY ("bot_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_bot_owner_idx" ON "users" USING btree ("bot_owner_id") WHERE "users"."bot_owner_id" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_scope" CHECK ("users"."is_bot" = (num_nonnulls("users"."bot_board_id", "users"."bot_team_id", "users"."bot_owner_id") = 1));