ALTER TYPE "public"."board_automation_kind" ADD VALUE 'move_card';--> statement-breakpoint
ALTER TABLE "board_automations" DROP CONSTRAINT "board_automations_unique";--> statement-breakpoint
ALTER TABLE "board_automations" DROP CONSTRAINT "board_automations_kind_fields";--> statement-breakpoint
ALTER TABLE "board_automations" ADD COLUMN "column_id" uuid;--> statement-breakpoint
ALTER TABLE "board_automations" ADD COLUMN "target_column_id" uuid;--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_column_board_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_target_board_fk" FOREIGN KEY ("target_column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_unique" UNIQUE NULLS NOT DISTINCT("board_id","kind","column_id","tag_id","priority");--> statement-breakpoint
ALTER TABLE "board_automations" ADD CONSTRAINT "board_automations_kind_fields" CHECK (case "board_automations"."kind"::text
    when 'archive_done' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null and "board_automations"."target_column_id" is null
    when 'tag_stale' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is not null and "board_automations"."priority" is null and "board_automations"."target_column_id" is null
    when 'notify_stale' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null and "board_automations"."target_column_id" is null
    when 'raise_priority' then "board_automations"."days" between 0 and 365 and "board_automations"."priority" is not null and "board_automations"."tag_id" is null and "board_automations"."target_column_id" is null
    when 'move_card' then "board_automations"."days" between 1 and 365 and "board_automations"."tag_id" is null and "board_automations"."priority" is null
      and "board_automations"."column_id" is not null and "board_automations"."target_column_id" is not null and "board_automations"."target_column_id" <> "board_automations"."column_id"
    else false
  end);