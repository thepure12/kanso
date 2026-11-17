CREATE TYPE "public"."card_action_kind" AS ENUM('move', 'archive', 'priority', 'remind');--> statement-breakpoint
CREATE TABLE "card_scheduled_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"kind" "card_action_kind" NOT NULL,
	"run_on" date NOT NULL,
	"target_column_id" uuid,
	"priority" "card_priority",
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_scheduled_actions_kind_fields" CHECK (case "card_scheduled_actions"."kind"
    when 'move' then "card_scheduled_actions"."target_column_id" is not null and "card_scheduled_actions"."priority" is null and "card_scheduled_actions"."note" is null
    when 'priority' then "card_scheduled_actions"."priority" is not null and "card_scheduled_actions"."target_column_id" is null and "card_scheduled_actions"."note" is null
    when 'archive' then "card_scheduled_actions"."target_column_id" is null and "card_scheduled_actions"."priority" is null and "card_scheduled_actions"."note" is null
    when 'remind' then "card_scheduled_actions"."target_column_id" is null and "card_scheduled_actions"."priority" is null and coalesce(char_length("card_scheduled_actions"."note"), 0) <= 500
    else false
  end)
);
--> statement-breakpoint
ALTER TABLE "board_automations" DROP CONSTRAINT "board_automations_unique";--> statement-breakpoint
ALTER TABLE "board_automations" DROP CONSTRAINT "board_automations_kind_fields";--> statement-breakpoint
ALTER TABLE "board_automations" ADD COLUMN "card_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "skip_automations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "card_scheduled_actions" ADD CONSTRAINT "card_scheduled_actions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_scheduled_actions" ADD CONSTRAINT "card_scheduled_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_scheduled_actions" ADD CONSTRAINT "card_scheduled_actions_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_scheduled_actions" ADD CONSTRAINT "card_scheduled_actions_target_board_fk" FOREIGN KEY ("target_column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_scheduled_actions_run_on_idx" ON "card_scheduled_actions" USING btree ("run_on");--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_unique" UNIQUE NULLS NOT DISTINCT("board_id","kind","column_id","card_id","tag_id","priority");--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_scope" CHECK ("board_automations"."column_id" is null or "board_automations"."card_id" is null);--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_kind_fields" CHECK (case "board_automations"."kind"::text
    when 'archive_done' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null and "board_automations"."target_column_id" is null
    when 'tag_stale' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is not null and "board_automations"."priority" is null and "board_automations"."target_column_id" is null
    when 'notify_stale' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null and "board_automations"."target_column_id" is null
    when 'raise_priority' then "board_automations"."days" between 0 and 365 and "board_automations"."priority" is not null and "board_automations"."tag_id" is null and "board_automations"."target_column_id" is null
    when 'move_card' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null
      and ("board_automations"."column_id" is not null or "board_automations"."card_id" is not null) and "board_automations"."target_column_id" is not null and "board_automations"."target_column_id" is distinct from "board_automations"."column_id"
    else false
  end);