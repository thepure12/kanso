ALTER TABLE "board_buttons" ADD CONSTRAINT "board_buttons_id_board_id_unique" UNIQUE("id","board_id");--> statement-breakpoint
CREATE TABLE "board_button_cards" (
	"button_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	CONSTRAINT "board_button_cards_button_id_card_id_pk" PRIMARY KEY("button_id","card_id")
);
--> statement-breakpoint
ALTER TABLE "board_button_cards" ADD CONSTRAINT "board_button_cards_button_fk" FOREIGN KEY ("button_id","board_id") REFERENCES "public"."board_buttons"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_button_cards" ADD CONSTRAINT "board_button_cards_card_fk" FOREIGN KEY ("card_id","board_id") REFERENCES "public"."cards"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_button_cards_card_idx" ON "board_button_cards" USING btree ("card_id");
