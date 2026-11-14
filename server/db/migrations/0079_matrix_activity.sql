CREATE TABLE "matrix_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_matrix_rooms" ADD COLUMN "post_activity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "board_matrix_rooms" ADD COLUMN "activity_events" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "matrix_deliveries" ADD CONSTRAINT "matrix_deliveries_activity_id_card_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."card_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_deliveries" ADD CONSTRAINT "matrix_deliveries_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matrix_deliveries_due_idx" ON "matrix_deliveries" USING btree ("next_attempt_at") WHERE "matrix_deliveries"."status" = 'pending';