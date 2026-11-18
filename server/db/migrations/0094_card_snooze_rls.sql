-- Snoozed cards (0093: cards.snoozed_until, never on templates).
-- A snoozed card is hidden from the board like an archived one (GET
-- /api/boards/:id leaves it out, GET /api/boards/:id/snoozed lists it) but
-- stays readable and editable through the normal cards policies, so no policy
-- changes. Snoozing logs `snoozed` {until}, clearing it logs `woke`; the
-- hourly task wakes cards whose date has come (app.wake_snoozed_cards), which
-- logs `woke` as an automation and notifies assignees and watchers (event
-- `reminder`). Board, column and card automations skip snoozed cards.

-- ---------------------------------------------------------------- activity

-- As in 0029, plus snoozed / woke.
CREATE OR REPLACE FUNCTION app.log_card_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'created',
      jsonb_build_object('column', (SELECT title FROM public.columns WHERE id = NEW.column_id)));
    RETURN NULL;
  END IF;
  IF OLD.column_id IS DISTINCT FROM NEW.column_id THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'moved', jsonb_build_object(
      'from', (SELECT title FROM public.columns WHERE id = OLD.column_id),
      'to', (SELECT title FROM public.columns WHERE id = NEW.column_id)));
  END IF;
  IF OLD.title IS DISTINCT FROM NEW.title THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'renamed', jsonb_build_object('from', OLD.title, 'to', NEW.title));
  END IF;
  IF OLD.description IS DISTINCT FROM NEW.description THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'described');
  END IF;
  IF OLD.start_date IS DISTINCT FROM NEW.start_date THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'start', jsonb_build_object('to', NEW.start_date));
  END IF;
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'due', jsonb_build_object('to', NEW.due_date));
  END IF;
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'priority', jsonb_build_object('to', NEW.priority));
  END IF;
  IF OLD.estimate IS DISTINCT FROM NEW.estimate THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'estimate', jsonb_build_object('to', NEW.estimate::text));
  END IF;
  IF (OLD.archived_at IS NULL) <> (NEW.archived_at IS NULL) THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, CASE WHEN NEW.archived_at IS NULL THEN 'restored' ELSE 'archived' END);
  END IF;
  IF OLD.snoozed_until IS DISTINCT FROM NEW.snoozed_until THEN
    IF NEW.snoozed_until IS NULL THEN
      PERFORM app.log_activity(NEW.id, NEW.board_id, 'woke');
    ELSE
      PERFORM app.log_activity(NEW.id, NEW.board_id, 'snoozed', jsonb_build_object('until', NEW.snoozed_until));
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER cards_log_activity ON cards;
--> statement-breakpoint
CREATE TRIGGER cards_log_activity
AFTER INSERT OR UPDATE OF column_id, title, description, start_date, due_date, priority, estimate, archived_at, snoozed_until ON cards
FOR EACH ROW EXECUTE FUNCTION app.log_card_activity();
--> statement-breakpoint

-- ---------------------------------------------------------------- wake-up

-- Clears snoozed_until on cards whose date has come (DB time zone), on
-- unarchived boards, skipping archived and trashed cards (they wake once back
-- and the task runs again). Automation mode: actor null, `automation: true`.
-- The UPDATE re-checks each row after a concurrent wake, so several instances
-- wake a card once. only_board limits the run to one board (tests).
CREATE FUNCTION app.wake_snoozed_cards(only_board uuid DEFAULT NULL)
RETURNS TABLE (card_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.automation', 'on', true);
  RETURN QUERY
    UPDATE public.cards c SET snoozed_until = NULL, updated_at = now()
    WHERE c.snoozed_until <= current_date AND c.archived_at IS NULL AND c.deleted_at IS NULL
      AND (only_board IS NULL OR c.board_id = only_board)
      AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = c.board_id AND b.archived_at IS NULL)
    RETURNING c.id;
  PERFORM set_config('app.automation', '', true);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.wake_snoozed_cards(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.wake_snoozed_cards(uuid) TO kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- notifications

-- As in 0070, plus `woke` counting as a reminder (notificationEvent mirrors it).
CREATE OR REPLACE FUNCTION app.notification_event(kind text, data jsonb, u uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN kind = 'mentioned' OR (kind = 'commented' AND coalesce(data -> 'mentions', '[]') ? u::text) THEN 'mentioned'
    WHEN kind = 'woke' THEN 'reminder'
    ELSE kind END
$$;
--> statement-breakpoint

-- As in 0090, plus `woke`.
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
  personal uuid := CASE WHEN NEW.kind = 'reminder' THEN (NEW.data ->> 'user_id')::uuid END;
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived', 'stale', 'reminder', 'woke')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO mentioned
  FROM jsonb_array_elements_text(coalesce(NEW.data -> 'mentions', '[]')) x;

  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT r.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM (
    SELECT p.user_id, bool_or(p.src = 'assignee') AS assignee, bool_or(p.src = 'mention') AS mention,
      bool_or(p.src = 'direct') AS direct
    FROM (
      SELECT ca.user_id, 'assignee' AS src FROM public.card_assignees ca
      WHERE ca.card_id = NEW.card_id AND NEW.kind <> 'mentioned' AND personal IS NULL
        AND (NEW.kind <> 'assigned' OR ca.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT w.user_id, 'watcher' FROM public.card_watchers w
      WHERE w.card_id = NEW.card_id AND NEW.kind <> 'mentioned' AND personal IS NULL
        AND (NEW.kind <> 'assigned' OR w.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT unnest(mentioned), 'mention'
      UNION ALL
      SELECT personal, 'direct' WHERE personal IS NOT NULL
    ) p
    GROUP BY p.user_id
  ) r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.board_notification_settings s ON s.board_id = NEW.board_id AND s.user_id = r.user_id
  WHERE r.user_id IS DISTINCT FROM NEW.actor_id
    AND app.is_member(NEW.board_id, r.user_id)
    AND app.user_card_access(r.user_id, NEW.card_id) <> 'none'
    -- Only watching: the user may have turned watched cards off.
    AND (r.assignee OR r.mention OR r.direct OR NEW.kind = 'assigned' OR u.notify_watching)
    AND (s.level IS NULL OR (s.level = 'direct' AND (r.mention OR r.direct OR NEW.kind = 'assigned')))
    AND app.notify_on(u.notification_prefs, app.notification_event(NEW.kind::text, NEW.data, r.user_id), 'inbox');
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- automations

-- As in 0086, minus snoozed cards (also for a card's own automations).
CREATE OR REPLACE FUNCTION app.automation_targets(a public.board_automations)
RETURNS SETOF public.cards
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT x.* FROM app.automation_cards(a.board_id, CASE a.kind::text
      WHEN 'archive_done' THEN coalesce(a.column_id,
        (SELECT id FROM public.columns WHERE board_id = a.board_id ORDER BY position DESC LIMIT 1))
      WHEN 'move_card' THEN coalesce(a.column_id, (SELECT column_id FROM public.cards WHERE id = a.card_id))
      ELSE a.column_id END) x
  WHERE x.snoozed_until IS NULL
    AND CASE WHEN a.card_id IS NULL THEN NOT x.skip_automations ELSE x.id = a.card_id END
$$;
