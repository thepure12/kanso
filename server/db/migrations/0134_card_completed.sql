ALTER TYPE "public"."board_rule_event" ADD VALUE 'card_completed';--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_completed_not_template" CHECK (not ("cards"."is_template" and "cards"."completed_at" is not null));