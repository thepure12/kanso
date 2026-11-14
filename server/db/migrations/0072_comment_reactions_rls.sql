-- Emoji reactions on comments: everyone with board access (viewers too) reads
-- them and adds or removes only their own rows; no changes while the board is
-- archived.
GRANT SELECT, INSERT, DELETE ON comment_reactions TO kanban_app;
--> statement-breakpoint
ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY comment_reactions_select ON comment_reactions FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY comment_reactions_insert ON comment_reactions FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL
    AND NOT app.board_archived(board_id));
--> statement-breakpoint
CREATE POLICY comment_reactions_delete ON comment_reactions FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id() AND NOT app.board_archived(board_id));
--> statement-breakpoint
CREATE TRIGGER comment_reactions_notify AFTER INSERT OR UPDATE OR DELETE ON comment_reactions
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
