ALTER TYPE "public"."column_rule_kind" ADD VALUE 'assign_mover';--> statement-breakpoint
ALTER TABLE "column_rules" DROP CONSTRAINT "column_rules_kind_fields";--> statement-breakpoint
CREATE UNIQUE INDEX "column_rules_one_mover_per_column" ON "column_rules" USING btree ("column_id") WHERE "column_rules"."tag_id" is null and "column_rules"."user_id" is null and "column_rules"."due_days" is null;--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_kind_fields" CHECK (case "column_rules"."kind"::text
    when 'apply_tag' then "column_rules"."tag_id" is not null and "column_rules"."user_id" is null and "column_rules"."due_days" is null
    when 'remove_tag' then "column_rules"."tag_id" is not null and "column_rules"."user_id" is null and "column_rules"."due_days" is null
    when 'assign_to' then "column_rules"."user_id" is not null and "column_rules"."tag_id" is null and "column_rules"."due_days" is null
    when 'set_due' then "column_rules"."due_days" between 0 and 365 and "column_rules"."tag_id" is null and "column_rules"."user_id" is null
    when 'assign_mover' then "column_rules"."tag_id" is null and "column_rules"."user_id" is null and "column_rules"."due_days" is null
    else false
  end);