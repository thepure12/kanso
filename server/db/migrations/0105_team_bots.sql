ALTER TABLE "users" DROP CONSTRAINT "users_bot_board";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bot_team_id" uuid;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_team_id_teams_id_fk" FOREIGN KEY ("bot_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_bot_team_idx" ON "users" USING btree ("bot_team_id") WHERE "users"."bot_team_id" is not null;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_one_limit" CHECK ("api_tokens"."board_ids" is null or "api_tokens"."team_id" is null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bot_scope" CHECK ("users"."is_bot" = (num_nonnulls("users"."bot_board_id", "users"."bot_team_id") = 1));