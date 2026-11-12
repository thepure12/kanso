CREATE TYPE "public"."board_automation_kind" AS ENUM('archive_done', 'tag_stale', 'notify_stale', 'raise_priority');--> statement-breakpoint
CREATE TABLE "board_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"kind" "board_automation_kind" NOT NULL,
	"days" integer NOT NULL,
	"tag_id" uuid,
	"priority" "card_priority",
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_automations_unique" UNIQUE NULLS NOT DISTINCT("board_id","kind","tag_id","priority"),
	CONSTRAINT "board_automations_kind_fields" CHECK (case "board_automations"."kind"::text
    when 'archive_done' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null
    when 'tag_stale' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is not null and "board_automations"."priority" is null
    when 'notify_stale' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null
    when 'raise_priority' then "board_automations"."days" between 0 and 365 and "board_automations"."priority" is not null and "board_automations"."tag_id" is null
    else false
  end)
);
--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_tag_board_fk" FOREIGN KEY ("tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;