CREATE TYPE "public"."board_access" AS ENUM('none', 'read', 'edit');--> statement-breakpoint
CREATE TABLE "board_member_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"column_id" uuid,
	"card_id" uuid,
	"access" "board_access" NOT NULL,
	CONSTRAINT "board_member_access_target" CHECK (num_nonnulls("board_member_access"."column_id", "board_member_access"."card_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "board_member_limits" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"default_access" "board_access" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_member_limits_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "board_member_access" ADD CONSTRAINT "board_member_access_limit_fk" FOREIGN KEY ("board_id","user_id") REFERENCES "public"."board_member_limits"("board_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member_access" ADD CONSTRAINT "board_member_access_column_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member_access" ADD CONSTRAINT "board_member_access_card_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member_limits" ADD CONSTRAINT "board_member_limits_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member_limits" ADD CONSTRAINT "board_member_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_member_access_column_unique" ON "board_member_access" USING btree ("board_id","user_id","column_id") WHERE "board_member_access"."column_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "board_member_access_card_unique" ON "board_member_access" USING btree ("board_id","user_id","card_id") WHERE "board_member_access"."card_id" is not null;--> statement-breakpoint
CREATE INDEX "board_member_limits_user_idx" ON "board_member_limits" USING btree ("user_id");