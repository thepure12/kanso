ALTER TABLE "api_tokens" ADD COLUMN "token_enc" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "viewable" boolean GENERATED ALWAYS AS (token_enc is not null) STORED;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_viewed_at" timestamp with time zone;