ALTER TYPE "public"."column_rule_kind" ADD VALUE 'add_button';--> statement-breakpoint
ALTER TYPE "public"."column_rule_kind" ADD VALUE 'remove_button';--> statement-breakpoint
ALTER TABLE "column_rules" DROP CONSTRAINT "column_rules_kind_fields";--> statement-breakpoint
DROP INDEX "column_rules_one_mover_per_column";--> statement-breakpoint
ALTER TABLE "column_rules" ADD COLUMN "button_id" uuid;--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_button_board_fk" FOREIGN KEY ("button_id","board_id") REFERENCES "public"."board_buttons"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "column_rules_one_mover_per_column" ON "column_rules" USING btree ("column_id") WHERE "column_rules"."tag_id" is null and "column_rules"."user_id" is null and "column_rules"."due_days" is null and "column_rules"."button_id" is null;--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_column_kind_button_unique" UNIQUE("column_id","kind","button_id");--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_kind_fields" CHECK (case "column_rules"."kind"::text
    when 'apply_tag' then "column_rules"."tag_id" is not null and "column_rules"."user_id" is null and "column_rules"."due_days" is null and "column_rules"."button_id" is null
    when 'remove_tag' then "column_rules"."tag_id" is not null and "column_rules"."user_id" is null and "column_rules"."due_days" is null and "column_rules"."button_id" is null
    when 'assign_to' then "column_rules"."user_id" is not null and "column_rules"."tag_id" is null and "column_rules"."due_days" is null and "column_rules"."button_id" is null
    when 'set_due' then "column_rules"."due_days" between 0 and 365 and "column_rules"."tag_id" is null and "column_rules"."user_id" is null and "column_rules"."button_id" is null
    when 'assign_mover' then "column_rules"."tag_id" is null and "column_rules"."user_id" is null and "column_rules"."due_days" is null and "column_rules"."button_id" is null
    when 'add_button' then "column_rules"."button_id" is not null and "column_rules"."tag_id" is null and "column_rules"."user_id" is null and "column_rules"."due_days" is null
    when 'remove_button' then "column_rules"."button_id" is not null and "column_rules"."tag_id" is null and "column_rules"."user_id" is null and "column_rules"."due_days" is null
    else false
  end);