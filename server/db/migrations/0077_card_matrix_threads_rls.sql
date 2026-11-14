-- Matrix thread per card: board members read the link, editors make and drop
-- it (not while archived, via app.can_edit). The row is written before the
-- server talks to Matrix (so the policy decides first) and then filled with
-- the room and root event, hence the column UPDATE grant.
GRANT SELECT, INSERT, DELETE ON card_matrix_threads TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (room_id, event_id) ON card_matrix_threads TO kanban_app;
--> statement-breakpoint
ALTER TABLE card_matrix_threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_matrix_threads_select ON card_matrix_threads FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_matrix_threads_insert ON card_matrix_threads FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY card_matrix_threads_update ON card_matrix_threads FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id))
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY card_matrix_threads_delete ON card_matrix_threads FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER card_matrix_threads_notify AFTER INSERT OR UPDATE OR DELETE ON card_matrix_threads
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- The board's room and sealed bot token for anyone on the board: the server
-- reads and posts threads with it on their behalf (what they may do is decided
-- by the policies above before it is used). Otherwise no row.
CREATE FUNCTION app.matrix_room_bot(b uuid)
RETURNS TABLE (homeserver_url text, room_id text, access_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT m.homeserver_url, m.room_id, m.access_token
  FROM public.board_matrix_rooms m
  WHERE m.board_id = b AND app.board_role(b) IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.matrix_room_bot(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.matrix_room_bot(uuid) TO kanban_app;
