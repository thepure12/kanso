-- Personal card reminders ("Remind me"). Like card_watchers, each person
-- sees and manages only their own rows, on cards they can see. A reminder
-- fires at remind_at: either a fixed time, or before_due_days days before the
-- card's due date at due_time in time_zone (computed here, recomputed when the
-- due date changes). app.run_card_reminders() (cards:reminders task) logs a
-- `reminder` activity with data.user_id: only that person sees the entry
-- (card_activity_select) and gets the notification; webhooks and Matrix skip it.

-- ---------------------------------------------------------------- time

-- When a due-date reminder fires: due_time on the day `days` before `due`, in tz.
CREATE FUNCTION app.card_reminder_time(due date, days integer, t text, tz text)
RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN due IS NULL THEN NULL ELSE ((due - days) + t::time) AT TIME ZONE tz END
$$;
--> statement-breakpoint

-- Server-owned fields: remind_at of due-date reminders, sent_at, created_at.
-- A time that has already passed is refused (KB010).
CREATE FUNCTION app.prepare_card_reminder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.sent_at := NULL;
  NEW.created_at := now();
  IF NEW.before_due_days IS NOT NULL THEN
    -- Unknown zones raise 22023.
    PERFORM now() AT TIME ZONE NEW.time_zone;
    NEW.remind_at := app.card_reminder_time(
      (SELECT due_date FROM public.cards WHERE id = NEW.card_id), NEW.before_due_days, NEW.due_time, NEW.time_zone);
  END IF;
  IF NEW.remind_at IS NOT NULL AND NEW.remind_at <= now() THEN
    RAISE EXCEPTION 'reminder time has passed' USING ERRCODE = 'KB010';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_reminders_prepare BEFORE INSERT ON card_reminders
FOR EACH ROW EXECUTE FUNCTION app.prepare_card_reminder();
--> statement-breakpoint

-- A new due date moves the card's due-date reminders (everyone's); one moved
-- into the future fires again.
CREATE FUNCTION app.reschedule_card_reminders() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.card_reminders r
  SET remind_at = x.at, sent_at = CASE WHEN x.at > now() THEN NULL ELSE r.sent_at END
  FROM (
    SELECT id, app.card_reminder_time(NEW.due_date, before_due_days, due_time, time_zone) AS at
    FROM public.card_reminders WHERE card_id = NEW.id AND before_due_days IS NOT NULL
  ) x
  WHERE r.id = x.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cards_reschedule_reminders AFTER UPDATE OF due_date ON cards
FOR EACH ROW WHEN (OLD.due_date IS DISTINCT FROM NEW.due_date)
EXECUTE FUNCTION app.reschedule_card_reminders();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.card_reminder_time(date, integer, text, text), app.prepare_card_reminder(), app.reschedule_card_reminders() FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------- policies

-- No UPDATE: change a reminder by deleting it and adding a new one.
GRANT SELECT, INSERT, DELETE ON card_reminders TO kanban_app;
--> statement-breakpoint
ALTER TABLE card_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_reminders_select ON card_reminders FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL AND app.can_see_card(card_id));
--> statement-breakpoint
-- Own rows on visible, non-trashed, non-template cards (the subquery runs under the cards policies).
CREATE POLICY card_reminders_insert ON card_reminders FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL AND app.can_see_card(card_id)
    AND EXISTS (SELECT 1 FROM cards c WHERE c.id = card_id AND NOT c.is_template));
--> statement-breakpoint
CREATE POLICY card_reminders_delete ON card_reminders FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint

-- Personal reminder entries (data.user_id) are visible to their person only.
ALTER POLICY card_activity_select ON card_activity
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids()))
    AND (kind <> 'reminder' OR NOT (data ? 'user_id') OR data ->> 'user_id' = app.current_user_id()::text));
--> statement-breakpoint

-- ---------------------------------------------------------------- runner

-- Fires due reminders (kanban_auth, every minute): logs `reminder`
-- {user_id, note?} with app.user_id empty and app.automation 'on' (so the entry
-- does not count as card activity for stale automations). Fixed-time reminders
-- are deleted once fired; due-date ones keep sent_at so a later due date can
-- re-arm them. Waits while the board is archived or the card trashed.
-- only_board limits the run to one board (tests).
CREATE FUNCTION app.run_card_reminders(only_board uuid DEFAULT NULL)
RETURNS TABLE (reminder_id uuid, card_id uuid, user_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  r public.card_reminders;
BEGIN
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.automation', 'on', true);
  FOR r IN
    SELECT cr.* FROM public.card_reminders cr
    JOIN public.boards b ON b.id = cr.board_id
    JOIN public.cards c ON c.id = cr.card_id
    WHERE cr.sent_at IS NULL AND cr.remind_at <= now() AND b.archived_at IS NULL AND c.deleted_at IS NULL
      AND (only_board IS NULL OR cr.board_id = only_board)
    ORDER BY cr.remind_at
    FOR UPDATE OF cr SKIP LOCKED
  LOOP
    BEGIN
      PERFORM app.log_activity(r.card_id, r.board_id, 'reminder', jsonb_build_object('user_id', r.user_id)
        || CASE WHEN coalesce(r.note, '') = '' THEN '{}'::jsonb ELSE jsonb_build_object('note', r.note) END);
      reminder_id := r.id; card_id := r.card_id; user_id := r.user_id; RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'card reminder % failed: %', r.id, SQLERRM;
    END;
    IF r.before_due_days IS NULL THEN
      DELETE FROM public.card_reminders WHERE id = r.id;
    ELSE
      UPDATE public.card_reminders SET sent_at = now() WHERE id = r.id;
    END IF;
  END LOOP;
  PERFORM set_config('app.automation', '', true);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.run_card_reminders(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.run_card_reminders(uuid) TO kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- notifications

-- As in 0088; a personal reminder (data.user_id) goes to its person only, as a
-- direct notification (also with the board level `direct`).
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
  personal uuid := CASE WHEN NEW.kind = 'reminder' THEN (NEW.data ->> 'user_id')::uuid END;
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived', 'stale', 'reminder')
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

-- As in 0041; personal reminders stay private.
CREATE OR REPLACE FUNCTION app.enqueue_webhooks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.kind = 'reminder' AND NEW.data ? 'user_id')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.webhook_deliveries (webhook_id, activity_id)
  SELECT w.id, NEW.id FROM public.board_webhooks w
  WHERE w.board_id = NEW.board_id AND w.active AND (cardinality(w.events) = 0 OR NEW.kind = ANY (w.events));
  IF FOUND THEN
    PERFORM pg_notify('board_webhooks', json_build_object('a', NEW.id)::text);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- As in 0080; personal reminders stay private.
CREATE OR REPLACE FUNCTION app.enqueue_matrix_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.kind = 'reminder' AND NEW.data ? 'user_id')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
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
