ALTER TABLE "cards" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_trash_idx" ON "cards" USING btree ("board_id","deleted_at") WHERE "cards"."deleted_at" is not null;