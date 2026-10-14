ALTER TABLE "cards" DROP CONSTRAINT "cards_assignee_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "assignee_id";