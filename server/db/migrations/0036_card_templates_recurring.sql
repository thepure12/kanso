CREATE TYPE "public"."recurrence_rule" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "card_recurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"template_card_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"rule" "recurrence_rule" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"weekdays" smallint[],
	"day_of_month" smallint,
	"due_in_days" integer,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_recurrences_template_unique" UNIQUE("template_card_id"),
	CONSTRAINT "card_recurrences_interval_range" CHECK ("card_recurrences"."interval" between 1 and 365),
	CONSTRAINT "card_recurrences_due_in_days_range" CHECK ("card_recurrences"."due_in_days" between 0 and 365),
	CONSTRAINT "card_recurrences_rule_fields" CHECK (case "card_recurrences"."rule"::text
    when 'daily' then "card_recurrences"."weekdays" is null and "card_recurrences"."day_of_month" is null
    when 'weekly' then "card_recurrences"."weekdays" is not null and cardinality("card_recurrences"."weekdays") between 1 and 7 and "card_recurrences"."weekdays" <@ '{1,2,3,4,5,6,7}'::smallint[] and "card_recurrences"."day_of_month" is null
    when 'monthly' then "card_recurrences"."day_of_month" is not null and "card_recurrences"."day_of_month" between 1 and 31 and "card_recurrences"."weekdays" is null
    else false
  end)
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "is_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "card_recurrences" ADD CONSTRAINT "card_recurrences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_recurrences" ADD CONSTRAINT "card_recurrences_card_board_fk" FOREIGN KEY ("template_card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_recurrences" ADD CONSTRAINT "card_recurrences_column_board_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_recurrences_due_idx" ON "card_recurrences" USING btree ("next_run_at") WHERE "card_recurrences"."active";