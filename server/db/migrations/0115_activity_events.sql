-- Filtered activity events for GET /api/events?activity=... (live streams for
-- scripts and agents). Every card activity entry sends NOTIFY card_activity
-- with ids only: {"a": activity id, "b": board, "card": card, "kind": kind,
-- "col": the card's current column (for a move: where it landed), "c": client
-- id}. The stream filters by kind and column per subscription and checks that
-- the listener may read the entry (card_activity_select under RLS) before
-- forwarding it. Personal reminders and boards created in the same
-- transaction (copies, imports) send nothing, as for webhooks.
CREATE FUNCTION app.notify_card_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  col uuid;
BEGIN
  IF (NEW.kind = 'reminder' AND NEW.data ? 'user_id')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND created_at = now()) THEN
    RETURN NULL;
  END IF;
  SELECT column_id INTO col FROM public.cards WHERE id = NEW.card_id;
  PERFORM pg_notify('card_activity', json_build_object(
    'a', NEW.id, 'b', NEW.board_id, 'card', NEW.card_id, 'kind', NEW.kind, 'col', col,
    'c', coalesce(current_setting('app.client_id', true), ''))::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.notify_card_activity() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER card_activity_notify AFTER INSERT ON card_activity
FOR EACH ROW EXECUTE FUNCTION app.notify_card_activity();
