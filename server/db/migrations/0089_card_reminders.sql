CREATE TABLE "card_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"remind_at" timestamp with time zone,
	"before_due_days" smallint,
	"due_time" text,
	"time_zone" text,
	"note" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_reminders_shape" CHECK (("card_reminders"."before_due_days" is null and "card_reminders"."due_time" is null and "card_reminders"."time_zone" is null and "card_reminders"."remind_at" is not null)
    or ("card_reminders"."before_due_days" between 0 and 365 and "card_reminders"."due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "card_reminders"."time_zone" is not null)),
	CONSTRAINT "card_reminders_note_length" CHECK (coalesce(char_length("card_reminders"."note"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "card_reminders" ADD CONSTRAINT "card_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_reminders" ADD CONSTRAINT "card_reminders_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_reminders_card_user_idx" ON "card_reminders" USING btree ("card_id","user_id");--> statement-breakpoint
CREATE INDEX "card_reminders_due_idx" ON "card_reminders" USING btree ("remind_at") WHERE "card_reminders"."sent_at" is null;