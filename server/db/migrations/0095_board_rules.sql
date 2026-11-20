CREATE TYPE "public"."board_rule_event" AS ENUM('card_created', 'card_moved', 'tag_added', 'assigned', 'due_set', 'checklist_completed', 'commented');--> statement-breakpoint
CREATE TABLE "board_rule_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"event" "board_rule_event" NOT NULL,
	"tag_id" uuid,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "board_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"event" "board_rule_event" NOT NULL,
	"event_tag_id" uuid,
	"event_user_id" uuid,
	"cond_tag_id" uuid,
	"cond_priority" "card_priority",
	"cond_column_id" uuid,
	"cond_assignee_id" uuid,
	"move_column_id" uuid,
	"add_tag_id" uuid,
	"remove_tag_id" uuid,
	"assign_user_id" uuid,
	"set_priority" "card_priority",
	"set_due_days" integer,
	"archive" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_rules_event_fields" CHECK (("board_rules"."event_tag_id" is null or "board_rules"."event"::text = 'tag_added') and ("board_rules"."event_user_id" is null or "board_rules"."event"::text = 'assigned')),
	CONSTRAINT "board_rules_has_action" CHECK ("board_rules"."move_column_id" is not null or "board_rules"."add_tag_id" is not null or "board_rules"."remove_tag_id" is not null
    or "board_rules"."assign_user_id" is not null or "board_rules"."set_priority" is not null or "board_rules"."set_due_days" is not null or "board_rules"."archive"),
	CONSTRAINT "board_rules_due_days" CHECK ("board_rules"."set_due_days" between 0 and 365),
	CONSTRAINT "board_rules_tags_differ" CHECK ("board_rules"."add_tag_id" is distinct from "board_rules"."remove_tag_id" or "board_rules"."add_tag_id" is null)
);
--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_event_user_id_users_id_fk" FOREIGN KEY ("event_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_cond_assignee_id_users_id_fk" FOREIGN KEY ("cond_assignee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_assign_user_id_users_id_fk" FOREIGN KEY ("assign_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_event_tag_fk" FOREIGN KEY ("event_tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_cond_tag_fk" FOREIGN KEY ("cond_tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_cond_column_fk" FOREIGN KEY ("cond_column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_move_column_fk" FOREIGN KEY ("move_column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_add_tag_fk" FOREIGN KEY ("add_tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_rules" ADD CONSTRAINT "board_rules_remove_tag_fk" FOREIGN KEY ("remove_tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_rules_board_idx" ON "board_rules" USING btree ("board_id");