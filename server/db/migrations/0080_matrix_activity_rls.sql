-- Card activity posted into linked Matrix threads. Owners turn it on per
-- board and pick the activity kinds (empty = all), like webhook events.
GRANT SELECT (post_activity, activity_events) ON board_matrix_rooms TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (post_activity, activity_events) ON board_matrix_rooms TO kanban_app;
--> statement-breakpoint

-- The outbox has no grants and no policies: only the functions below touch it.
ALTER TABLE matrix_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Queues the activity for the card's thread when the board posts activity of
-- this kind, and wakes the senders (NOTIFY matrix_deliveries, sent at
-- commit). Like webhooks, boards created in the same transaction and archived
-- boards send nothing; templates log no activity at all.
CREATE FUNCTION app.enqueue_matrix_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.matrix_deliveries (activity_id, board_id)
  SELECT NEW.id, NEW.board_id
  FROM public.card_matrix_threads t
  JOIN public.board_matrix_rooms m ON m.board_id = t.board_id
  WHERE t.card_id = NEW.card_id AND t.event_id <> '' AND m.post_activity
    AND (cardinality(m.activity_events) = 0 OR NEW.kind = ANY (m.activity_events));
  IF FOUND THEN
    PERFORM pg_notify('matrix_deliveries', json_build_object('a', NEW.id)::text);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_activity_matrix AFTER INSERT ON card_activity
FOR EACH ROW EXECUTE FUNCTION app.enqueue_matrix_activity();
--> statement-breakpoint

-- Claims up to max_rows due deliveries (kanban_auth; SKIP LOCKED plus a 2
-- minute lease, like app.claim_webhook_deliveries) with what the message
-- needs: the card's current thread, the sealed bot token and the language of
-- whoever connected the room. Queued rows whose thread, room or setting went
-- away are dropped, finished rows after 7 days.
CREATE FUNCTION app.claim_matrix_deliveries(max_rows integer DEFAULT 20)
RETURNS TABLE (delivery_id uuid, attempt integer, homeserver_url text, room_id text, thread_id text, access_token text,
  kind text, data jsonb, card_id uuid, card_title text, board_id uuid, board_name text, actor_name text, locale text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.matrix_deliveries d
  WHERE (d.status <> 'pending' AND d.created_at < now() - interval '7 days')
     OR (d.status = 'pending' AND NOT EXISTS (
       SELECT 1 FROM public.card_activity a
       JOIN public.card_matrix_threads t ON t.card_id = a.card_id AND t.event_id <> ''
       JOIN public.board_matrix_rooms m ON m.board_id = t.board_id AND m.post_activity
       WHERE a.id = d.activity_id));
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.matrix_deliveries d
    WHERE d.status = 'pending' AND d.next_attempt_at <= now()
    ORDER BY d.next_attempt_at, d.created_at
    LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.matrix_deliveries d
    SET attempts = d.attempts + 1, next_attempt_at = now() + interval '2 minutes'
    FROM due WHERE d.id = due.id
    RETURNING d.id, d.activity_id, d.attempts
  )
  SELECT c.id, c.attempts, m.homeserver_url, t.room_id, t.event_id, m.access_token,
    a.kind, a.data, k.id, k.title, b.id, b.name, u.name, cu.locale
  FROM claimed c
  JOIN public.card_activity a ON a.id = c.activity_id
  JOIN public.card_matrix_threads t ON t.card_id = a.card_id
  JOIN public.board_matrix_rooms m ON m.board_id = t.board_id
  JOIN public.cards k ON k.id = a.card_id
  JOIN public.boards b ON b.id = a.board_id
  LEFT JOIN public.users u ON u.id = a.actor_id
  LEFT JOIN public.users cu ON cu.id = m.created_by;
END
$$;
--> statement-breakpoint

-- Outcome of a claimed delivery: delivered, or retried after 1 min, 5 min,
-- 30 min, 2 h, and failed after the 5th attempt.
CREATE FUNCTION app.finish_matrix_delivery(d uuid, ok boolean, err text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  UPDATE public.matrix_deliveries SET
    status = CASE WHEN ok THEN 'delivered' WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
    last_error = CASE WHEN ok THEN NULL ELSE left(err, 500) END,
    next_attempt_at = now() + CASE attempts
      WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' WHEN 3 THEN interval '30 minutes' ELSE interval '2 hours' END
  WHERE id = d AND status = 'pending'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.enqueue_matrix_activity(), app.claim_matrix_deliveries(integer), app.finish_matrix_delivery(uuid, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_matrix_deliveries(integer), app.finish_matrix_delivery(uuid, boolean, text) TO kanban_auth;
