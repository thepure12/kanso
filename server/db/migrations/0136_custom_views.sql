CREATE TABLE "custom_view_columns" (
	"view_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "custom_view_columns_view_id_column_id_pk" PRIMARY KEY("view_id","column_id")
);
--> statement-breakpoint
CREATE TABLE "custom_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_views_name_length" CHECK (char_length("custom_views"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "custom_view_columns" ADD CONSTRAINT "custom_view_columns_view_id_custom_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."custom_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_view_columns" ADD CONSTRAINT "custom_view_columns_column_fk" FOREIGN KEY ("column_id","board_id") REFERENCES "public"."columns"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_views" ADD CONSTRAINT "custom_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_view_columns_column_idx" ON "custom_view_columns" USING btree ("column_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_views_name_unique" ON "custom_views" USING btree ("user_id",lower("name"));