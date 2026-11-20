CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklists_id_card_id_unique" UNIQUE("id","card_id"),
	CONSTRAINT "checklists_name_length" CHECK (char_length("checklists"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD COLUMN "checklist_id" uuid;--> statement-breakpoint
-- Existing items go into one checklist per card named "Checklist".
INSERT INTO "checklists" ("card_id", "board_id", "name", "position")
SELECT DISTINCT "card_id", "board_id", 'Checklist', 1024 FROM "checklist_items";--> statement-breakpoint
UPDATE "checklist_items" ci SET "checklist_id" = c."id" FROM "checklists" c WHERE c."card_id" = ci."card_id";--> statement-breakpoint
ALTER TABLE "checklist_items" ALTER COLUMN "checklist_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklists_card_idx" ON "checklists" USING btree ("card_id");--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_card_fk" FOREIGN KEY ("checklist_id","card_id") REFERENCES "public"."checklists"("id","card_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_checklist_idx" ON "checklist_items" USING btree ("checklist_id");