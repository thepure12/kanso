CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"board_id" uuid,
	"team_id" uuid,
	"role" "board_role" NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_one_target" CHECK (num_nonnulls("invites"."board_id", "invites"."team_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_email_board" ON "invites" USING btree ("email","board_id") WHERE "invites"."board_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_email_team" ON "invites" USING btree ("email","team_id") WHERE "invites"."team_id" is not null;--> statement-breakpoint
CREATE INDEX "invites_email" ON "invites" USING btree ("email");