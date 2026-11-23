CREATE TYPE "public"."agent_rule_event" AS ENUM('card_created', 'card_moved', 'tag_added', 'assigned', 'mentioned');--> statement-breakpoint
CREATE TABLE "board_agent_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"event" "agent_rule_event" NOT NULL,
	"column_id" uuid,
	"tag_id" uuid,
	"instructions" text NOT NULL,
	"move_column_id" uuid,
	"comment" text DEFAULT 'never' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_agent_rules_name_length" CHECK (char_length(btrim("board_agent_rules"."name")) between 1 and 100),
	CONSTRAINT "board_agent_rules_instructions_length" CHECK (char_length(btrim("board_agent_rules"."instructions")) between 1 and 20000),
	CONSTRAINT "board_agent_rules_comment_known" CHECK ("board_agent_rules"."comment" in ('never', 'failure', 'always'))
);
--> statement-breakpoint
ALTER TABLE "board_agent_rules" ADD CONSTRAINT "board_agent_rules_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_agent_rules" ADD CONSTRAINT "board_agent_rules_bot_id_users_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_agent_rules" ADD CONSTRAINT "board_agent_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_agent_rules" ADD CONSTRAINT "board_agent_rules_column_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_agent_rules" ADD CONSTRAINT "board_agent_rules_tag_fk" FOREIGN KEY ("tag_id","board_id") REFERENCES "public"."tags"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_agent_rules" ADD CONSTRAINT "board_agent_rules_move_column_fk" FOREIGN KEY ("move_column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_agent_rules_board_idx" ON "board_agent_rules" USING btree ("board_id");