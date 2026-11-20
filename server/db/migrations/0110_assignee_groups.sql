CREATE TABLE "assignee_group_members" (
	"group_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "assignee_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "assignee_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignee_groups_id_board_id_unique" UNIQUE("id","board_id"),
	CONSTRAINT "assignee_groups_name_length" CHECK (char_length("assignee_groups"."name") between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "assignee_group_members" ADD CONSTRAINT "assignee_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignee_group_members" ADD CONSTRAINT "assignee_group_members_group_fk" FOREIGN KEY ("group_id","board_id") REFERENCES "public"."assignee_groups"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignee_groups" ADD CONSTRAINT "assignee_groups_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignee_group_members_user_idx" ON "assignee_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignee_groups_board_name_unique" ON "assignee_groups" USING btree ("board_id",lower("name"));