CREATE TYPE "public"."card_link_kind" AS ENUM('blocks', 'relates', 'duplicates');--> statement-breakpoint
CREATE TABLE "card_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"from_card_id" uuid NOT NULL,
	"to_card_id" uuid NOT NULL,
	"kind" "card_link_kind" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_links_from_to_kind_unique" UNIQUE("from_card_id","to_card_id","kind"),
	CONSTRAINT "card_links_not_self" CHECK ("card_links"."from_card_id" <> "card_links"."to_card_id")
);
--> statement-breakpoint
CREATE TABLE "card_watchers" (
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_watchers_card_id_user_id_pk" PRIMARY KEY("card_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_from_board_fk" FOREIGN KEY ("from_card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_to_board_fk" FOREIGN KEY ("to_card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_watchers" ADD CONSTRAINT "card_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_watchers" ADD CONSTRAINT "card_watchers_card_board_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_links_relates_pair" ON "card_links" USING btree (least("from_card_id", "to_card_id"),greatest("from_card_id", "to_card_id")) WHERE "card_links"."kind" = 'relates';--> statement-breakpoint
CREATE INDEX "card_links_to_idx" ON "card_links" USING btree ("to_card_id");--> statement-breakpoint
CREATE INDEX "card_watchers_user_idx" ON "card_watchers" USING btree ("user_id");