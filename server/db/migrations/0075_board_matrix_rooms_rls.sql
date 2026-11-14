-- Matrix room per board. Board members see that a room is connected (and
-- which); effective owners connect, change and disconnect it. The bot's access
-- token (sealed by the server) is write-only for kanban_app: the server reads
-- it back through app.matrix_room_credentials (owners only).
GRANT SELECT (board_id, homeserver_url, room_id, room_name, bot_user_id, created_by, created_at, updated_at)
  ON board_matrix_rooms TO kanban_app;
--> statement-breakpoint
GRANT INSERT ON board_matrix_rooms TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (homeserver_url, room_id, room_name, bot_user_id, access_token, updated_at) ON board_matrix_rooms TO kanban_app;
--> statement-breakpoint
GRANT DELETE ON board_matrix_rooms TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_matrix_rooms ADD CONSTRAINT board_matrix_rooms_homeserver_http
  CHECK (homeserver_url ~ '^https?://');
--> statement-breakpoint
ALTER TABLE board_matrix_rooms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_matrix_rooms_select ON board_matrix_rooms FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_matrix_rooms_insert ON board_matrix_rooms FOR INSERT TO kanban_app
  WITH CHECK (app.board_role(board_id) = 'owner' AND created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY board_matrix_rooms_update ON board_matrix_rooms FOR UPDATE TO kanban_app
  USING (app.board_role(board_id) = 'owner')
  WITH CHECK (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY board_matrix_rooms_delete ON board_matrix_rooms FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE TRIGGER board_matrix_rooms_notify AFTER INSERT OR UPDATE OR DELETE ON board_matrix_rooms
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- The sealed token and where to use it, for the board's effective owners
-- (connection test, keeping the token when the room changes); otherwise no row.
CREATE FUNCTION app.matrix_room_credentials(b uuid)
RETURNS TABLE (homeserver_url text, room_id text, access_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT m.homeserver_url, m.room_id, m.access_token
  FROM public.board_matrix_rooms m
  WHERE m.board_id = b AND app.board_role(b) = 'owner'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.matrix_room_credentials(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.matrix_room_credentials(uuid) TO kanban_app;
