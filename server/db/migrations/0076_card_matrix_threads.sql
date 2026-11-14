CREATE TABLE "card_matrix_threads" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"event_id" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_matrix_threads" ADD CONSTRAINT "card_matrix_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_matrix_threads" ADD CONSTRAINT "card_matrix_threads_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;