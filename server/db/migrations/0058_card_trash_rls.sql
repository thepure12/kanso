-- Trash for deleted cards (cards.deleted_at, 0057). A deleted card stays in
-- its column and position but the cards_select policy hides it, so every query
-- of kanban_app skips it without changes (board, search, my work, export, due
-- soon, links, bulk actions, ...). Owner-run functions bypass RLS and filter
-- explicitly below. Editors list, restore and purge trashed cards through the
-- SECURITY DEFINER functions here; app.purge_trash (task cards:trash, daily)
-- deletes cards trashed more than 30 days ago.

-- ---------------------------------------------------------------- policies

DROP POLICY cards_select ON cards;
--> statement-breakpoint
CREATE POLICY cards_select ON cards FOR SELECT TO kanban_app
  USING (deleted_at IS NULL AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
DROP POLICY cards_insert ON cards;
--> statement-breakpoint
CREATE POLICY cards_insert ON cards FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id() AND deleted_at IS NULL AND deleted_by IS NULL);
--> statement-breakpoint
DROP POLICY cards_update ON cards;
--> statement-breakpoint
CREATE POLICY cards_update ON cards FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id) AND deleted_at IS NULL AND deleted_by IS NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------- trash

-- Moves a card (or template) to the trash. False when it is not there, already
-- trashed or the caller cannot edit the board.
CREATE FUNCTION app.trash_card(card uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH t AS (
    UPDATE public.cards SET deleted_at = now(), deleted_by = app.current_user_id()
    WHERE id = card AND deleted_at IS NULL AND app.can_edit(board_id)
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM t)
$$;
--> statement-breakpoint
-- Brings a trashed card back to its column, at its old position.
CREATE FUNCTION app.restore_card(card uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH t AS (
    UPDATE public.cards SET deleted_at = NULL, deleted_by = NULL
    WHERE id = card AND deleted_at IS NOT NULL AND app.can_edit(board_id)
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM t)
$$;
--> statement-breakpoint
-- Deletes one trashed card of board b for good.
CREATE FUNCTION app.purge_trashed_card(b uuid, card uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH t AS (
    DELETE FROM public.cards
    WHERE id = card AND board_id = b AND deleted_at IS NOT NULL AND app.can_edit(board_id)
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM t)
$$;
--> statement-breakpoint
-- Deletes every trashed card of a board for good; returns how many.
CREATE FUNCTION app.empty_trash(b uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT app.can_edit(b) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.cards WHERE board_id = b AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
-- A board's trash, newest first. Editors only (viewers cannot restore).
CREATE FUNCTION app.trashed_cards(b uuid)
RETURNS TABLE (id uuid, title text, column_id uuid, is_template boolean, deleted_at timestamptz, deleted_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT app.can_edit(b) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id, c.title, c.column_id, c.is_template, c.deleted_at, u.name
    FROM public.cards c LEFT JOIN public.users u ON u.id = c.deleted_by
    WHERE c.board_id = b AND c.deleted_at IS NOT NULL
    ORDER BY c.deleted_at DESC, c.id;
END
$$;
--> statement-breakpoint
-- Task cards:trash (kanban_auth): deletes cards trashed more than 30 days ago
-- (of one board with only_board, used by tests).
CREATE FUNCTION app.purge_trash(only_board uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.cards
  WHERE deleted_at < now() - interval '30 days' AND (only_board IS NULL OR board_id = only_board);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.trash_card(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.trash_card(uuid) TO kanban_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.restore_card(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.restore_card(uuid) TO kanban_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.purge_trashed_card(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_trashed_card(uuid, uuid) TO kanban_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.empty_trash(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.empty_trash(uuid) TO kanban_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.trashed_cards(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.trashed_cards(uuid) TO kanban_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.purge_trash(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_trash(uuid) TO kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- owner-run functions

-- These run as the owner (no RLS), so they skip trashed cards themselves.
-- As in 0043, minus trashed cards.
CREATE OR REPLACE FUNCTION app.claim_digests()
RETURNS TABLE (user_id uuid, email text, name text, locale text, items jsonb, due jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH pending AS (
    SELECT u.id, u.digest_sent_at AS prev FROM public.users u
    WHERE u.digest_enabled AND u.email_verified_at IS NOT NULL
      AND (u.digest_sent_at IS NULL OR u.digest_sent_at < date_trunc('day', now()))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.users u SET digest_sent_at = now()
    FROM pending p WHERE u.id = p.id
    RETURNING u.id, u.email::text AS email, u.name, u.locale, p.prev
  )
  SELECT c.id, c.email, c.name, c.locale, i.items, d.due
  FROM claimed c
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'createdAt' DESC), '[]') AS items FROM (
      SELECT jsonb_build_object(
        'boardId', n.board_id, 'boardName', b.name, 'cardId', n.card_id, 'cardTitle', k.title,
        'actorName', au.name, 'kind', a.kind, 'data', a.data, 'createdAt', a.created_at) AS x
      FROM public.notifications n
      JOIN public.card_activity a ON a.id = n.activity_id
      JOIN public.cards k ON k.id = n.card_id AND k.deleted_at IS NULL
      JOIN public.boards b ON b.id = n.board_id
      LEFT JOIN public.users au ON au.id = a.actor_id
      WHERE n.user_id = c.id AND n.read_at IS NULL
        AND n.created_at > coalesce(c.prev, '-infinity')
        AND b.archived_at IS NULL
        AND app.is_member(n.board_id, c.id)
      ORDER BY n.created_at DESC LIMIT 50
    ) s
  ) i
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'boardId', k.board_id, 'boardName', b.name, 'cardId', k.id, 'cardTitle', k.title, 'dueDate', k.due_date)
      ORDER BY k.due_date), '[]') AS due
    FROM public.card_assignees ca
    JOIN public.cards k ON k.id = ca.card_id
    JOIN public.boards b ON b.id = k.board_id
    WHERE ca.user_id = c.id AND k.archived_at IS NULL AND k.deleted_at IS NULL AND NOT k.is_template AND b.archived_at IS NULL
      AND k.due_date <= current_date + 1
      AND app.is_member(k.board_id, c.id)
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
--> statement-breakpoint
-- As in 0056, minus trashed cards.
CREATE OR REPLACE FUNCTION app.automation_open_cards(b uuid)
RETURNS SETOF public.cards
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT c.* FROM public.cards c
  WHERE c.board_id = b AND NOT c.is_template AND c.archived_at IS NULL AND c.deleted_at IS NULL
    AND c.column_id IS DISTINCT FROM (SELECT id FROM public.columns WHERE board_id = b ORDER BY position DESC LIMIT 1)
$$;
--> statement-breakpoint
-- As in 0056, minus trashed cards (archive_done).
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
      IF a.kind = 'archive_done' THEN
        FOR c IN
          UPDATE public.cards SET archived_at = now()
          WHERE id IN (
            SELECT x.id FROM public.cards x
            WHERE x.board_id = a.board_id AND NOT x.is_template AND x.archived_at IS NULL AND x.deleted_at IS NULL
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
-- As in 0037; a trashed template only advances its schedule.
CREATE OR REPLACE FUNCTION app.run_due_recurrences()
RETURNS TABLE (recurrence_id uuid, card_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  r public.card_recurrences;
  next_date date;
  new_card uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.card_recurrences
    WHERE active AND next_run_at <= now()
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
  LOOP
    next_date := app.recurrence_next(r.rule, r.interval, r.weekdays, r.day_of_month, r.next_run_at::date, false);
    WHILE next_date <= current_date LOOP
      next_date := app.recurrence_next(r.rule, r.interval, r.weekdays, r.day_of_month, next_date, false);
    END LOOP;
    PERFORM set_config('app.user_id', coalesce(r.created_by::text, ''), true);

    IF app.board_archived(r.board_id)
       OR EXISTS (SELECT 1 FROM public.cards WHERE id = r.template_card_id AND deleted_at IS NOT NULL) THEN
      UPDATE public.card_recurrences SET next_run_at = next_date WHERE id = r.id;
    ELSIF r.created_by IS NULL OR NOT app.can_edit(r.board_id) THEN
      UPDATE public.card_recurrences SET active = false WHERE id = r.id;
    ELSE
      BEGIN
        new_card := app.copy_card(r.template_card_id, r.column_id, false, true, r.due_in_days);
        recurrence_id := r.id;
        card_id := new_card;
        RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'recurring card % failed: %', r.id, SQLERRM;
      END;
      UPDATE public.card_recurrences SET next_run_at = next_date, last_run_at = now() WHERE id = r.id;
    END IF;
  END LOOP;
  PERFORM set_config('app.user_id', '', true);
END
$$;
