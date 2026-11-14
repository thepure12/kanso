CREATE TABLE "comment_reactions" (
	"comment_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_comment_id_user_id_emoji_pk" PRIMARY KEY("comment_id","user_id","emoji"),
	CONSTRAINT "comment_reactions_emoji_known" CHECK ("comment_reactions"."emoji" in ('👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'))
);
--> statement-breakpoint
ALTER TABLE "card_comments" ADD CONSTRAINT "card_comments_id_board_unique" UNIQUE("id","board_id");--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_board_fk" FOREIGN KEY ("comment_id","board_id") REFERENCES "public"."card_comments"("id","board_id") ON DELETE cascade ON UPDATE no action;
