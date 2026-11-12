-- Time-based board automations (board_automations, 0055), run hourly by
-- app.run_board_automations() from the Nitro task cards:automations.

-- ---------------------------------------------------------------- policies

-- As column rules: anyone who can see the board sees its automations; editors
-- and owners manage them. Kind, tag and priority are fixed at creation.
GRANT SELECT, INSERT, UPDATE (days, active), DELETE ON board_automations TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_automations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_automations_select ON board_automations FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_automations_insert ON board_automations FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY board_automations_update ON board_automations FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY board_automations_delete ON board_automations FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER board_automations_notify AFTER INSERT OR UPDATE OR DELETE ON board_automations
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- ---------------------------------------------------------------- activity

-- As in 0037, plus `automation: true` in the data of activity logged while
-- app.automation is 'on' (set by app.run_board_automations), so the log can
-- say an automation did it. The actor is then null.
CREATE OR REPLACE FUNCTION app.log_activity(card uuid, board uuid, activity_kind text, activity_data jsonb DEFAULT '{}')
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.card_activity (card_id, board_id, actor_id, kind, data, created_at)
  SELECT card, board, app.current_user_id(), activity_kind,
         CASE WHEN current_setting('app.automation', true) = 'on'
              THEN activity_data || '{"automation": true}'::jsonb ELSE activity_data END,
         clock_timestamp()
  WHERE EXISTS (SELECT 1 FROM public.cards WHERE id = card AND NOT is_template)
$$;
--> statement-breakpoint

-- As in 0035, plus `stale` (logged by notify_stale automations).
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived', 'stale')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO mentioned
  FROM jsonb_array_elements_text(coalesce(NEW.data -> 'mentions', '[]')) x;

  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT r.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM (
    SELECT p.user_id FROM (
      SELECT ca.user_id FROM public.card_assignees ca WHERE ca.card_id = NEW.card_id
      UNION
      SELECT w.user_id FROM public.card_watchers w WHERE w.card_id = NEW.card_id
    ) p
    WHERE NEW.kind <> 'mentioned'
      AND (NEW.kind <> 'assigned' OR p.user_id = (NEW.data ->> 'user_id')::uuid)
    UNION
    SELECT unnest(mentioned)
  ) r
  WHERE r.user_id IS DISTINCT FROM NEW.actor_id
    AND app.is_member(NEW.board_id, r.user_id);
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- runner

-- Open cards of a board: not templates, not archived, not in the last column
-- (the board's "done" column, as in the UI).
CREATE FUNCTION app.automation_open_cards(b uuid)
RETURNS SETOF public.cards
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT c.* FROM public.cards c
  WHERE c.board_id = b AND NOT c.is_template AND c.archived_at IS NULL
    AND c.column_id IS DISTINCT FROM (SELECT id FROM public.columns WHERE board_id = b ORDER BY position DESC LIMIT 1)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.automation_open_cards(uuid) FROM PUBLIC;
--> statement-breakpoint

-- Last time a person did something to the card (or its creation). Activity
-- of automations does not count, so one automation tagging a card does not
-- hide it from another that notifies about it.
CREATE FUNCTION app.card_last_activity(card public.cards)
RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT greatest(card.created_at, (SELECT max(created_at) FROM public.card_activity
    WHERE card_id = card.id AND NOT coalesce((data ->> 'automation')::boolean, false)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.card_last_activity(public.cards) FROM PUBLIC;
--> statement-breakpoint

-- Runs every active automation of unarchived boards once and returns the
-- cards it changed. Idempotent: archive_done, tag_stale and raise_priority
-- only touch cards not yet in the target state; notify_stale logs `stale` at
-- most once per `days` days on a card (its own last `stale` entry). Staleness
-- ignores automation activity (app.card_last_activity). Rows are locked (SKIP LOCKED), so several
-- instances never run one automation twice at once.
-- Changes are made with app.user_id empty (actor null) and app.automation
-- 'on' (activity data `automation: true`); the usual triggers log activity,
-- notify the board and send notifications and webhooks.
-- only_board limits the run to one board (tests); null runs every board.
CREATE FUNCTION app.run_board_automations(only_board uuid DEFAULT NULL)
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
      IF a.kind = 'archive_done' THEN
        FOR c IN
          UPDATE public.cards SET archived_at = now()
          WHERE id IN (
            SELECT x.id FROM public.cards x
            WHERE x.board_id = a.board_id AND NOT x.is_template AND x.archived_at IS NULL
              AND x.column_id = (SELECT id FROM public.columns WHERE board_id = a.board_id ORDER BY position DESC LIMIT 1)
              -- When the card got into its column: last created/moved/restored entry, else its creation.
              AND greatest(x.created_at, (SELECT max(created_at) FROM public.card_activity
                WHERE card_id = x.id AND kind IN ('created', 'moved', 'restored'))) <= now() - make_interval(days => a.days))
          RETURNING id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind = 'tag_stale' THEN
        FOR c IN
          INSERT INTO public.card_tags (card_id, tag_id, board_id)
          SELECT x.id, a.tag_id, a.board_id FROM app.automation_open_cards(a.board_id) x
          WHERE app.card_last_activity(x) <= now() - make_interval(days => a.days)
          ON CONFLICT DO NOTHING
          RETURNING card_tags.card_id AS id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind = 'notify_stale' THEN
        FOR c IN
          SELECT x.id FROM app.automation_open_cards(a.board_id) x
          WHERE app.card_last_activity(x) <= now() - make_interval(days => a.days)
            AND NOT EXISTS (SELECT 1 FROM public.card_activity s
              WHERE s.card_id = x.id AND s.kind = 'stale' AND s.created_at > now() - make_interval(days => a.days))
        LOOP
          PERFORM app.log_activity(c.id, a.board_id, 'stale', jsonb_build_object('days', a.days));
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind = 'raise_priority' THEN
        FOR c IN
          UPDATE public.cards SET priority = a.priority
          WHERE id IN (
            SELECT x.id FROM app.automation_open_cards(a.board_id) x
            WHERE x.due_date <= current_date + a.days
              AND (x.priority IS NULL OR x.priority < a.priority))
          RETURNING id
        LOOP
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
REVOKE ALL ON FUNCTION app.run_board_automations(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.run_board_automations(uuid) TO kanban_auth;
