CREATE TABLE "board_matrix_users" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mxid" text NOT NULL,
	"code" text DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 10)),
	"code_expires_at" timestamp with time zone DEFAULT now() + interval '15 minutes',
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_matrix_users_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "board_matrix_users" ADD CONSTRAINT "board_matrix_users_board_id_board_matrix_rooms_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board_matrix_rooms"("board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_matrix_users" ADD CONSTRAINT "board_matrix_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_matrix_users_mxid_idx" ON "board_matrix_users" USING btree ("board_id","mxid") WHERE "board_matrix_users"."verified_at" IS NOT NULL;