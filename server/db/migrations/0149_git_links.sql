CREATE TABLE "board_git_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"repo" text NOT NULL,
	"column_id" uuid NOT NULL,
	"label" text,
	"close_action" text DEFAULT 'none' NOT NULL,
	"token" text,
	"has_token" boolean GENERATED ALWAYS AS (token is not null) STORED NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_git_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"card_id" uuid,
	"link_id" uuid,
	"provider" text DEFAULT 'github' NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_git_links" ADD CONSTRAINT "board_git_links_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_git_links" ADD CONSTRAINT "board_git_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_git_links" ADD CONSTRAINT "board_git_links_column_id_board_id_columns_id_board_id_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_git_issues" ADD CONSTRAINT "card_git_issues_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_git_issues" ADD CONSTRAINT "card_git_issues_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_git_issues" ADD CONSTRAINT "card_git_issues_link_id_board_git_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."board_git_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_git_links_board_idx" ON "board_git_links" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_git_issues_issue_idx" ON "card_git_issues" USING btree ("board_id","provider","repo","number");--> statement-breakpoint
CREATE INDEX "card_git_issues_card_idx" ON "card_git_issues" USING btree ("card_id");