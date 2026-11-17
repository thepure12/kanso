-- Per-card automations (0085):
--   board_automations.card_id      limits an automation to one card (fixed at creation, not with column_id)
--   cards.skip_automations         board and column automations leave the card alone; its own still run
--   card_scheduled_actions         one-shot actions on a date (move, archive, priority, remind), deleted once run
-- move_card and the scheduled kinds are compared as text where the enum is new.

-- ---------------------------------------------------------------- scheduled actions

-- As board automations: anyone who can see the board sees them, editors add
-- and delete them (no updates: delete and add again). Only on normal cards.
GRANT SELECT, INSERT, DELETE ON card_scheduled_actions TO kanban_app;
--> statement-breakpoint
ALTER TABLE card_scheduled_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_scheduled_actions_select ON card_scheduled_actions FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_scheduled_actions_insert ON card_scheduled_actions FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id()
    AND EXISTS (SELECT 1 FROM cards c WHERE c.id = card_id AND NOT c.is_template));
--> statement-breakpoint
CREATE POLICY card_scheduled_actions_delete ON card_scheduled_actions FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER card_scheduled_actions_notify AFTER INSERT OR DELETE ON card_scheduled_actions
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- ---------------------------------------------------------------- board automations

-- The cards an automation looks at (app.automation_cards of 0084):
--   card_id    that card only (still open, or in the column for archive_done/move_card),
--              also with skip_automations
--   otherwise  the board's open cards or column_id's cards, minus skip_automations
-- archive_done looks at column_id or else the last column; a card's move_card at
-- the card's current column.
CREATE FUNCTION app.automation_targets(a public.board_automations)
RETURNS SETOF public.cards
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT x.* FROM app.automation_cards(a.board_id, CASE a.kind::text
      WHEN 'archive_done' THEN coalesce(a.column_id,
        (SELECT id FROM public.columns WHERE board_id = a.board_id ORDER BY position DESC LIMIT 1))
      WHEN 'move_card' THEN coalesce(a.column_id, (SELECT column_id FROM public.cards WHERE id = a.card_id))
      ELSE a.column_id END) x
  WHERE CASE WHEN a.card_id IS NULL THEN NOT x.skip_automations ELSE x.id = a.card_id END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.automation_targets(public.board_automations) FROM PUBLIC;
--> statement-breakpoint

-- As in 0084, with the cards from app.automation_targets. A card's move_card
-- leaves it alone once it is in the target column.
CREATE OR REPLACE FUNCTION app.run_board_automations(only_board uuid DEFAULT NULL)
RETURNS TABLE (automation_id uuid, card_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  a public.board_automations;
  c record;
BEGIN
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.automation', 'on', true);
  FOR a IN
    SELECT ba.* FROM public.board_automations ba
    JOIN public.boards b ON b.id = ba.board_id
    WHERE ba.active AND b.archived_at IS NULL AND (only_board IS NULL OR ba.board_id = only_board)
    ORDER BY ba.created_at
    FOR UPDATE OF ba SKIP LOCKED
  LOOP
    BEGIN
      IF a.kind::text = 'archive_done' THEN
        FOR c IN
          UPDATE public.cards SET archived_at = now()
          WHERE id IN (
            SELECT x.id FROM app.automation_targets(a) x
            WHERE app.card_entered_column(x) <= now() - make_interval(days => a.days))
          RETURNING id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'tag_stale' THEN
        FOR c IN
          INSERT INTO public.card_tags (card_id, tag_id, board_id)
          SELECT x.id, a.tag_id, a.board_id FROM app.automation_targets(a) x
          WHERE app.card_last_activity(x) <= now() - make_interval(days => a.days)
          ON CONFLICT DO NOTHING
          RETURNING card_tags.card_id AS id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'notify_stale' THEN
        FOR c IN
          SELECT x.id FROM app.automation_targets(a) x
          WHERE app.card_last_activity(x) <= now() - make_interval(days => a.days)
            AND NOT EXISTS (SELECT 1 FROM public.card_activity s
              WHERE s.card_id = x.id AND s.kind = 'stale' AND s.created_at > now() - make_interval(days => a.days))
        LOOP
          PERFORM app.log_activity(c.id, a.board_id, 'stale', jsonb_build_object('days', a.days));
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'raise_priority' THEN
        FOR c IN
          UPDATE public.cards SET priority = a.priority
          WHERE id IN (
            SELECT x.id FROM app.automation_targets(a) x
            WHERE x.due_date <= current_date + a.days
              AND (x.priority IS NULL OR x.priority < a.priority))
          RETURNING id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'move_card' THEN
        FOR c IN
          SELECT x.id FROM app.automation_targets(a) x
          WHERE app.card_entered_column(x) <= now() - make_interval(days => a.days)
            AND x.column_id <> a.target_column_id
          ORDER BY app.card_entered_column(x), x.position
        LOOP
          UPDATE public.cards SET column_id = a.target_column_id,
            position = coalesce((SELECT max(position) FROM public.cards WHERE column_id = a.target_column_id), 0) + 1024
          WHERE id = c.id;
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      END IF;
      UPDATE public.board_automations SET last_run_at = now() WHERE id = a.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'board automation % failed: %', a.id, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('app.automation', '', true);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- runner

-- Runs the scheduled actions due by today (run_on <= current_date) on
-- unarchived boards and deletes them; returns what ran. Trashed cards keep
-- theirs until restored or purged. Same mode as app.run_board_automations
-- (actor null, `automation: true`), so the usual triggers log, notify and
-- run column rules. Each action has its own exception block; a failed one is
-- dropped with a warning. only_board limits the run to one board (tests).
CREATE FUNCTION app.run_scheduled_card_actions(only_board uuid DEFAULT NULL)
RETURNS TABLE (action_id uuid, card_id uuid, kind text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  s public.card_scheduled_actions;
BEGIN
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.automation', 'on', true);
  FOR s IN
    SELECT sa.* FROM public.card_scheduled_actions sa
    JOIN public.boards b ON b.id = sa.board_id
    JOIN public.cards c ON c.id = sa.card_id
    WHERE sa.run_on <= current_date AND b.archived_at IS NULL AND c.deleted_at IS NULL
      AND (only_board IS NULL OR sa.board_id = only_board)
    ORDER BY sa.run_on, sa.created_at
    FOR UPDATE OF sa SKIP LOCKED
  LOOP
    BEGIN
      IF s.kind::text = 'move' THEN
        UPDATE public.cards SET column_id = s.target_column_id,
          position = coalesce((SELECT max(position) FROM public.cards WHERE column_id = s.target_column_id), 0) + 1024
        WHERE id = s.card_id AND column_id <> s.target_column_id;
      ELSIF s.kind::text = 'archive' THEN
        UPDATE public.cards SET archived_at = now() WHERE id = s.card_id AND archived_at IS NULL;
      ELSIF s.kind::text = 'priority' THEN
        UPDATE public.cards SET priority = s.priority WHERE id = s.card_id AND priority IS DISTINCT FROM s.priority;
      ELSIF s.kind::text = 'remind' THEN
        PERFORM app.log_activity(s.card_id, s.board_id, 'reminder',
          CASE WHEN coalesce(s.note, '') = '' THEN '{}'::jsonb ELSE jsonb_build_object('note', s.note) END);
      END IF;
      action_id := s.id; card_id := s.card_id; kind := s.kind::text; RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'scheduled card action % failed: %', s.id, SQLERRM;
    END;
    DELETE FROM public.card_scheduled_actions WHERE id = s.id;
  END LOOP;
  PERFORM set_config('app.automation', '', true);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.run_scheduled_card_actions(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.run_scheduled_card_actions(uuid) TO kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- reminder notifications

-- As in 0070, plus the event `reminder`.
CREATE OR REPLACE FUNCTION app.notification_prefs_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(p) e
    WHERE e.key NOT IN ('assigned', 'mentioned', 'commented', 'moved', 'due', 'archived', 'stale', 'reminder')
       OR jsonb_typeof(e.value) <> 'object'
       OR EXISTS (
         SELECT 1 FROM jsonb_each(e.value) c
         WHERE c.key NOT IN ('inbox', 'push', 'email') OR jsonb_typeof(c.value) <> 'boolean'
       )
  )
$$;
--> statement-breakpoint

-- As in 0070, plus `reminder` (logged by scheduled remind actions).
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
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
    SELECT p.user_id, bool_or(p.src = 'assignee') AS assignee, bool_or(p.src = 'mention') AS mention
    FROM (
      SELECT ca.user_id, 'assignee' AS src FROM public.card_assignees ca
      WHERE ca.card_id = NEW.card_id AND NEW.kind <> 'mentioned'
        AND (NEW.kind <> 'assigned' OR ca.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT w.user_id, 'watcher' FROM public.card_watchers w
      WHERE w.card_id = NEW.card_id AND NEW.kind <> 'mentioned'
        AND (NEW.kind <> 'assigned' OR w.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT unnest(mentioned), 'mention'
    ) p
    GROUP BY p.user_id
  ) r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.board_notification_settings s ON s.board_id = NEW.board_id AND s.user_id = r.user_id
  WHERE r.user_id IS DISTINCT FROM NEW.actor_id
    AND app.is_member(NEW.board_id, r.user_id)
    -- Only watching: the user may have turned watched cards off.
    AND (r.assignee OR r.mention OR NEW.kind = 'assigned' OR u.notify_watching)
    AND (s.level IS NULL OR (s.level = 'direct' AND (r.mention OR NEW.kind = 'assigned')))
    AND app.notify_on(u.notification_prefs, app.notification_event(NEW.kind::text, NEW.data, r.user_id), 'inbox');
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
