CREATE TYPE "public"."column_rule_kind" AS ENUM('apply_tag');--> statement-breakpoint
CREATE TABLE "column_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"kind" "column_rule_kind" NOT NULL,
	"tag_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "column_rules_column_kind_tag_unique" UNIQUE("column_id","kind","tag_id"),
	CONSTRAINT "column_rules_apply_tag_has_tag" CHECK ("column_rules"."kind" <> 'apply_tag' or "column_rules"."tag_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_column_board_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_tag_board_fk" FOREIGN KEY ("tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;