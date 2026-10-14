CREATE TYPE "public"."card_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
ALTER TYPE "public"."column_rule_kind" ADD VALUE 'remove_tag';--> statement-breakpoint
ALTER TYPE "public"."column_rule_kind" ADD VALUE 'set_due';--> statement-breakpoint
CREATE TABLE "card_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_assignees" (
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	CONSTRAINT "card_assignees_card_id_user_id_pk" PRIMARY KEY("card_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "card_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_attachments_size" CHECK ("card_attachments"."size" between 0 and 10485760 and octet_length("card_attachments"."data") = "card_attachments"."size")
);
--> statement-breakpoint
CREATE TABLE "card_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "column_rules" DROP CONSTRAINT "column_rules_kind_fields";--> statement-breakpoint
DROP INDEX "column_rules_one_assign_per_column";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "priority" "card_priority";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "column_rules" ADD COLUMN "due_days" integer;--> statement-breakpoint
ALTER TABLE "columns" ADD COLUMN "wip_limit" integer;--> statement-breakpoint
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_assignees" ADD CONSTRAINT "card_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_assignees" ADD CONSTRAINT "card_assignees_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_attachments" ADD CONSTRAINT "card_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_attachments" ADD CONSTRAINT "card_attachments_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_comments" ADD CONSTRAINT "card_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_comments" ADD CONSTRAINT "card_comments_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_activity_card_idx" ON "card_activity" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX "card_attachments_card_idx" ON "card_attachments" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "card_comments_card_idx" ON "card_comments" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "checklist_items_card_idx" ON "checklist_items" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "column_rules_one_due_per_column" ON "column_rules" USING btree ("column_id") WHERE "column_rules"."due_days" is not null;--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_column_kind_user_unique" UNIQUE("column_id","kind","user_id");--> statement-breakpoint
ALTER TABLE "column_rules" ADD CONSTRAINT "column_rules_kind_fields" CHECK (case "column_rules"."kind"::text
    when 'apply_tag' then "column_rules"."tag_id" is not null and "column_rules"."user_id" is null and "column_rules"."due_days" is null
    when 'remove_tag' then "column_rules"."tag_id" is not null and "column_rules"."user_id" is null and "column_rules"."due_days" is null
    when 'assign_to' then "column_rules"."user_id" is not null and "column_rules"."tag_id" is null and "column_rules"."due_days" is null
    when 'set_due' then "column_rules"."due_days" between 0 and 365 and "column_rules"."tag_id" is null and "column_rules"."user_id" is null
    else false
  end);--> statement-breakpoint
ALTER TABLE "columns" ADD CONSTRAINT "columns_wip_limit_range" CHECK ("columns"."wip_limit" between 1 and 999);