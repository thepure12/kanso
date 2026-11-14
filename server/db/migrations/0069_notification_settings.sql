CREATE TYPE "public"."board_notification_level" AS ENUM('direct', 'none');--> statement-breakpoint
CREATE TABLE "board_notification_settings" (
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"level" "board_notification_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_notification_settings_user_id_board_id_pk" PRIMARY KEY("user_id","board_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_watching" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "board_notification_settings" ADD CONSTRAINT "board_notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_notification_settings" ADD CONSTRAINT "board_notification_settings_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_notification_settings_board_idx" ON "board_notification_settings" USING btree ("board_id");