-- Replying to a card's Matrix thread from Kanso: the bot posts on behalf of
-- people who can edit the card's board (not while archived). Returns where to
-- post and the sealed token, else no row (also for trashed cards).
CREATE FUNCTION app.matrix_thread_reply_target(c uuid)
RETURNS TABLE (homeserver_url text, room_id text, event_id text, access_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT m.homeserver_url, t.room_id, t.event_id, m.access_token
  FROM public.card_matrix_threads t
  JOIN public.board_matrix_rooms m ON m.board_id = t.board_id
  JOIN public.cards k ON k.id = t.card_id
  WHERE t.card_id = c AND t.event_id <> '' AND k.deleted_at IS NULL AND app.can_edit(t.board_id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.matrix_thread_reply_target(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.matrix_thread_reply_target(uuid) TO kanban_app;
