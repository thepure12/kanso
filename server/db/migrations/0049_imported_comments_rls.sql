-- Imported comments (POST /api/boards/import) have no author_id and carry the
-- original author's name in imported_author. Only the import creates them: the
-- board must have been created in the same transaction (as for the notification
-- and auto-watch skips). Nobody is their author, so card_comments_update never
-- matches them; board owners delete them through card_comments_delete.
DROP POLICY card_comments_insert ON card_comments;
--> statement-breakpoint
CREATE POLICY card_comments_insert ON card_comments FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND (
    author_id = app.current_user_id()
    OR (author_id IS NULL AND imported_author IS NOT NULL
        AND EXISTS (SELECT 1 FROM boards b WHERE b.id = board_id AND b.created_at = now()))
  ));
--> statement-breakpoint

-- Imported comments are history, not new activity: no 'commented' entry, so
-- no mentions, notifications or webhooks either. Auto-watch already skips them
-- (no author, and the board is new).
DROP TRIGGER card_comments_log_activity ON card_comments;
--> statement-breakpoint
CREATE TRIGGER card_comments_log_activity
AFTER INSERT ON card_comments
FOR EACH ROW WHEN (NEW.imported_author IS NULL) EXECUTE FUNCTION app.log_card_comment_activity();
