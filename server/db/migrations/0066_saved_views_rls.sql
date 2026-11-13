-- Saved views: named board view, grouping, column group and filter.
-- user_id null = shared on the board, else personal. The scope is fixed at
-- creation (no UPDATE grant on user_id).

-- Shared views: everyone who sees the board reads them, editors manage them
-- (app.can_edit, so not while the board is archived). Personal views: only
-- their user, while they can see the board (viewers too, archived boards too,
-- like stars); a board-limited token only touches its boards'.
GRANT SELECT, INSERT, UPDATE (name, config), DELETE ON saved_views TO kanban_app;
--> statement-breakpoint
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY saved_views_select ON saved_views FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL AND (user_id IS NULL OR user_id = app.current_user_id()));
--> statement-breakpoint
CREATE POLICY saved_views_insert ON saved_views FOR INSERT TO kanban_app
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.board_role(board_id) IS NOT NULL
    AND (user_id = app.current_user_id() OR (user_id IS NULL AND app.can_edit(board_id)))
  );
--> statement-breakpoint
CREATE POLICY saved_views_update ON saved_views FOR UPDATE TO kanban_app
  USING ((user_id = app.current_user_id() AND app.token_allows(board_id)) OR (user_id IS NULL AND app.can_edit(board_id)))
  WITH CHECK ((user_id = app.current_user_id() AND app.token_allows(board_id)) OR (user_id IS NULL AND app.can_edit(board_id)));
--> statement-breakpoint
CREATE POLICY saved_views_delete ON saved_views FOR DELETE TO kanban_app
  USING ((user_id = app.current_user_id() AND app.token_allows(board_id)) OR (user_id IS NULL AND app.can_edit(board_id)));
--> statement-breakpoint

-- Only shared views change what other people see.
CREATE TRIGGER saved_views_notify_insert AFTER INSERT ON saved_views
FOR EACH ROW WHEN (NEW.user_id IS NULL) EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER saved_views_notify_update AFTER UPDATE ON saved_views
FOR EACH ROW WHEN (NEW.user_id IS NULL) EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER saved_views_notify_delete AFTER DELETE ON saved_views
FOR EACH ROW WHEN (OLD.user_id IS NULL) EXECUTE FUNCTION app.notify_board_change('board_id');
