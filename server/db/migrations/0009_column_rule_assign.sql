ALTER TYPE "public"."column_rule_kind" ADD VALUE 'assign_to';--> statement-breakpoint
ALTER TABLE "column_rules" DROP CONSTRAINT "column_rules_apply_tag_has_tag";--> statement-breakpoint
ALTER TABLE "column_rules" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "column_rules_one_assign_per_column" ON "column_rules" USING btree ("column_id") WHERE "column_rules"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_kind_fields" CHECK (case "column_rules"."kind"::text
    when 'apply_tag' then "column_rules"."tag_id" is not null and "column_rules"."user_id" is null
    when 'assign_to' then "column_rules"."user_id" is not null and "column_rules"."tag_id" is null
    else false
  end);