CREATE TABLE "column_group_members" (
	"group_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	CONSTRAINT "column_group_members_group_id_column_id_pk" PRIMARY KEY("group_id","column_id")
);
--> statement-breakpoint
CREATE TABLE "column_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "column_groups_id_board_id_unique" UNIQUE("id","board_id"),
	CONSTRAINT "column_groups_name_length" CHECK (char_length("column_groups"."name") between 1 and 50),
	CONSTRAINT "column_groups_color_hex" CHECK ("column_groups"."color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "column_group_members" ADD CONSTRAINT "column_group_members_group_fk" FOREIGN KEY ("group_id","board_id") REFERENCES "public"."column_groups"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_group_members" ADD CONSTRAINT "column_group_members_column_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_groups" ADD CONSTRAINT "column_groups_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "column_group_members_column_idx" ON "column_group_members" USING btree ("column_id");--> statement-breakpoint
CREATE UNIQUE INDEX "column_groups_board_name_unique" ON "column_groups" USING btree ("board_id",lower("name"));