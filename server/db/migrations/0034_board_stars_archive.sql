CREATE TABLE "board_stars" (
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_stars_user_id_board_id_pk" PRIMARY KEY("user_id","board_id")
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_stars" ADD CONSTRAINT "board_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_stars" ADD CONSTRAINT "board_stars_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_activity_board_idx" ON "card_activity" USING btree ("board_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);