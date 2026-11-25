CREATE INDEX "card_assignees_user_idx" ON "card_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cards_board_idx" ON "cards" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "columns_board_idx" ON "columns" USING btree ("board_id","position");