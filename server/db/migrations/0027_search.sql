ALTER TABLE "card_comments" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, body)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, title), 'A') || setweight(to_tsvector('simple'::regconfig, description), 'B')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "card_comments_search_idx" ON "card_comments" USING gin ("search");--> statement-breakpoint
CREATE INDEX "cards_search_idx" ON "cards" USING gin ("search");