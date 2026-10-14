CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid,
	"minutes" integer NOT NULL,
	"spent_on" date DEFAULT current_date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_minutes_positive" CHECK ("time_entries"."minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "estimate" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "cover_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_card_idx" ON "time_entries" USING btree ("card_id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_cover_attachment_id_card_attachments_id_fk" FOREIGN KEY ("cover_attachment_id") REFERENCES "public"."card_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_start_before_due" CHECK ("cards"."start_date" <= "cards"."due_date");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_estimate_range" CHECK ("cards"."estimate" >= 0);