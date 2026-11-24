CREATE TABLE "my_work_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "my_work_panels_name_length" CHECK (char_length("my_work_panels"."name") between 1 and 50),
	CONSTRAINT "my_work_panels_config_shape" CHECK (jsonb_typeof("my_work_panels"."config") = 'object' and pg_column_size("my_work_panels"."config") < 16384)
);
--> statement-breakpoint
ALTER TABLE "my_work_panels" ADD CONSTRAINT "my_work_panels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "my_work_panels_user_idx" ON "my_work_panels" USING btree ("user_id","position");