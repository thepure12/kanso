CREATE TYPE "public"."signup_mode" AS ENUM('open', 'restricted');--> statement-breakpoint
CREATE TABLE "instance_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"signup_mode" "signup_mode" DEFAULT 'restricted' NOT NULL,
	"allowed_domains" text[] DEFAULT '{}' NOT NULL,
	"allowed_emails" text[] DEFAULT '{}' NOT NULL,
	"allow_external_invites" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_single_row" CHECK ("instance_settings"."id")
);
--> statement-breakpoint
ALTER TABLE "boards" DROP CONSTRAINT "boards_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_admins" ADD CONSTRAINT "instance_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;