CREATE TABLE "board_matrix_rooms" (
	"board_id" uuid PRIMARY KEY NOT NULL,
	"homeserver_url" text NOT NULL,
	"room_id" text NOT NULL,
	"room_name" text,
	"bot_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_matrix_rooms" ADD CONSTRAINT "board_matrix_rooms_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_matrix_rooms" ADD CONSTRAINT "board_matrix_rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;