-- Tags: per-board labels with a colour. Anyone who can see the board sees its
-- tags; editors and owners create, change, delete and apply them.
-- card_tags carries board_id with composite FKs to cards and tags, so a card
-- can only carry tags of its own board.

GRANT SELECT, INSERT, UPDATE (name, color), DELETE ON tags TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON card_tags TO kanban_app;
--> statement-breakpoint

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tags_select ON tags FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY tags_insert ON tags FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY tags_update ON tags FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY tags_delete ON tags FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint

CREATE POLICY card_tags_select ON card_tags FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_tags_insert ON card_tags FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY card_tags_delete ON card_tags FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
