-- Card templates and recurring cards.
--
-- A template is a card with is_template set. It keeps a column (the default
-- target for cards made from it, so column_id stays NOT NULL with its
-- composite FK) and goes through the cards policies like any card, but is left
-- out of the board (GET /api/boards/:id lists it under templates), search,
-- notifications, the digest and column rules. Cards made from a template are
-- normal inserts, so rules run on them.

-- ---------------------------------------------------------------- templates

-- A card cannot turn into a template or back (KB007 -> 400); templates are
-- made by copying (app.copy_card).
CREATE FUNCTION app.check_card_template_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.is_template IS DISTINCT FROM NEW.is_template THEN
    RAISE EXCEPTION 'a card cannot become a template or stop being one' USING ERRCODE = 'KB007';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cards_template_fixed BEFORE UPDATE OF is_template ON cards
FOR EACH ROW EXECUTE FUNCTION app.check_card_template_fixed();
--> statement-breakpoint

-- Column rules and auto-watch skip templates.
DROP TRIGGER cards_apply_column_rules ON cards;
--> statement-breakpoint
CREATE TRIGGER cards_apply_column_rules
AFTER INSERT OR UPDATE OF column_id ON cards
FOR EACH ROW WHEN (NOT NEW.is_template) EXECUTE FUNCTION app.apply_column_rules();
--> statement-breakpoint
DROP TRIGGER cards_set_column_rule_fields ON cards;
--> statement-breakpoint
CREATE TRIGGER cards_set_column_rule_fields
BEFORE INSERT OR UPDATE OF column_id ON cards
FOR EACH ROW WHEN (NOT NEW.is_template) EXECUTE FUNCTION app.set_column_rule_fields();
--> statement-breakpoint
DROP TRIGGER cards_auto_watch ON cards;
--> statement-breakpoint
CREATE TRIGGER cards_auto_watch AFTER INSERT ON cards
FOR EACH ROW WHEN (NOT NEW.is_template) EXECUTE FUNCTION app.auto_watch_card();
--> statement-breakpoint

-- As in 0012, but templates have no activity log. Every notification starts
-- from an activity row, so templates notify nobody either.
CREATE OR REPLACE FUNCTION app.log_activity(card uuid, board uuid, activity_kind text, activity_data jsonb DEFAULT '{}')
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.card_activity (card_id, board_id, actor_id, kind, data, created_at)
  SELECT card, board, app.current_user_id(), activity_kind, activity_data, clock_timestamp()
  WHERE EXISTS (SELECT 1 FROM public.cards WHERE id = card AND NOT is_template)
$$;
--> statement-breakpoint

-- Copies a card into target_column (at the end) with its description,
-- priority, estimate, tags, checklist (unticked) and field values, and with
-- with_assignees its assignees who can still see the board. as_template makes
-- the copy a template ("save as template"); otherwise src must be a template
-- (KB008) and the copy is a normal card whose column rules run: tags the
-- column's remove_tag rules would drop are not copied. due_in_days sets the due
-- date (a set_due rule wins). Dates are not copied.
-- SECURITY INVOKER, like app.copy_board: reads and writes go through the
-- caller's policies.
CREATE FUNCTION app.copy_card(src uuid, target_column uuid, as_template boolean, with_assignees boolean,
  due_in_days integer DEFAULT NULL, card_title text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public
AS $$
DECLARE
  s public.cards;
  new_id uuid;
BEGIN
  SELECT * INTO s FROM public.cards WHERE id = src;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'card not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT as_template AND NOT s.is_template THEN
    RAISE EXCEPTION 'not a template' USING ERRCODE = 'KB008';
  END IF;

  INSERT INTO public.cards (board_id, column_id, title, description, position, priority, estimate, due_date, is_template, created_by)
  VALUES (s.board_id, target_column, coalesce(card_title, s.title), s.description,
          coalesce((SELECT max(position) FROM public.cards WHERE column_id = target_column), 0) + 1024,
          s.priority, s.estimate, current_date + due_in_days, as_template, app.current_user_id())
  RETURNING id INTO new_id;

  INSERT INTO public.card_tags (card_id, tag_id, board_id)
  SELECT new_id, ct.tag_id, s.board_id
  FROM public.card_tags ct
  WHERE ct.card_id = src
    AND (as_template OR NOT EXISTS (
      SELECT 1 FROM public.column_rules r
      WHERE r.column_id = target_column AND r.kind::text = 'remove_tag' AND r.tag_id = ct.tag_id))
  ON CONFLICT DO NOTHING;

  IF with_assignees THEN
    INSERT INTO public.card_assignees (card_id, user_id, board_id)
    SELECT new_id, ca.user_id, s.board_id
    FROM public.card_assignees ca
    WHERE ca.card_id = src AND app.is_member(s.board_id, ca.user_id)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.checklist_items (card_id, board_id, text, done, position)
  SELECT new_id, s.board_id, ci.text, false, ci.position
  FROM public.checklist_items ci WHERE ci.card_id = src;

  INSERT INTO public.card_field_values (card_id, board_id, field_id, value)
  SELECT new_id, s.board_id, v.field_id, v.value
  FROM public.card_field_values v WHERE v.card_id = src;

  RETURN new_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.copy_card(uuid, uuid, boolean, boolean, integer, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.copy_card(uuid, uuid, boolean, boolean, integer, text) TO kanban_app;
--> statement-breakpoint

-- As in 0035, minus templates in the due list.
CREATE OR REPLACE FUNCTION app.claim_digests()
RETURNS TABLE (user_id uuid, email text, name text, items jsonb, due jsonb)
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
    RETURNING u.id, u.email::text AS email, u.name, p.prev
  )
  SELECT c.id, c.email, c.name, i.items, d.due
  FROM claimed c
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'createdAt' DESC), '[]') AS items FROM (
      SELECT jsonb_build_object(
        'boardId', n.board_id, 'boardName', b.name, 'cardId', n.card_id, 'cardTitle', k.title,
        'actorName', au.name, 'kind', a.kind, 'data', a.data, 'createdAt', a.created_at) AS x
      FROM public.notifications n
      JOIN public.card_activity a ON a.id = n.activity_id
      JOIN public.cards k ON k.id = n.card_id
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
    WHERE ca.user_id = c.id AND k.archived_at IS NULL AND NOT k.is_template AND b.archived_at IS NULL
      AND k.due_date <= current_date + 1
      AND app.is_member(k.board_id, c.id)
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
--> statement-breakpoint

-- As in 0033, plus is_template, so a copy with cards keeps its templates
-- (as templates). Recurrences are not copied.
CREATE OR REPLACE FUNCTION app.copy_board(src uuid, board_name text, team uuid, with_cards boolean)
RETURNS public.boards
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public
AS $$
DECLARE
  b public.boards;
  column_map jsonb;
  tag_map jsonb;
  field_map jsonb;
  card_map jsonb;
BEGIN
  IF app.board_role(src) IS NULL THEN
    RAISE EXCEPTION 'no access to the source board' USING ERRCODE = '42501';
  END IF;
  b := app.create_board(board_name, team);

  WITH m AS (
    SELECT id AS old_id, gen_random_uuid() AS new_id, title, position, color, wip_limit
    FROM public.columns WHERE board_id = src
  ), ins AS (
    INSERT INTO public.columns (id, board_id, title, position, color, wip_limit)
    SELECT new_id, b.id, title, position, color, wip_limit FROM m
  )
  SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO column_map FROM m;

  WITH m AS (
    SELECT id AS old_id, gen_random_uuid() AS new_id, name, color
    FROM public.tags WHERE board_id = src
  ), ins AS (
    INSERT INTO public.tags (id, board_id, name, color)
    SELECT new_id, b.id, name, color FROM m
  )
  SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO tag_map FROM m;

  WITH m AS (
    SELECT id AS old_id, gen_random_uuid() AS new_id, name, kind, options, position, show_on_card
    FROM public.board_fields WHERE board_id = src
  ), ins AS (
    INSERT INTO public.board_fields (id, board_id, name, kind, options, position, show_on_card)
    SELECT new_id, b.id, name, kind, options, position, show_on_card FROM m
  )
  SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO field_map FROM m;

  IF with_cards THEN
    WITH m AS (
      SELECT id AS old_id, gen_random_uuid() AS new_id, column_id, title, description, position,
             start_date, due_date, priority, estimate, is_template
      FROM public.cards WHERE board_id = src AND archived_at IS NULL
    ), ins AS (
      INSERT INTO public.cards (id, board_id, column_id, title, description, position, start_date, due_date, priority, estimate, is_template, created_by)
      SELECT new_id, b.id, (column_map ->> column_id::text)::uuid, title, description, position,
             start_date, due_date, priority, estimate, is_template, app.current_user_id()
      FROM m
    )
    SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO card_map FROM m;

    INSERT INTO public.card_tags (card_id, tag_id, board_id)
    SELECT (card_map ->> ct.card_id::text)::uuid, (tag_map ->> ct.tag_id::text)::uuid, b.id
    FROM public.card_tags ct
    WHERE ct.board_id = src AND card_map ? ct.card_id::text;

    INSERT INTO public.card_assignees (card_id, user_id, board_id)
    SELECT (card_map ->> ca.card_id::text)::uuid, ca.user_id, b.id
    FROM public.card_assignees ca
    WHERE ca.board_id = src AND card_map ? ca.card_id::text AND app.is_member(b.id, ca.user_id);

    INSERT INTO public.checklist_items (card_id, board_id, text, done, position)
    SELECT (card_map ->> ci.card_id::text)::uuid, b.id, ci.text, ci.done, ci.position
    FROM public.checklist_items ci
    WHERE ci.board_id = src AND card_map ? ci.card_id::text;

    INSERT INTO public.card_links (board_id, from_card_id, to_card_id, kind, created_by)
    SELECT b.id, (card_map ->> l.from_card_id::text)::uuid, (card_map ->> l.to_card_id::text)::uuid, l.kind, app.current_user_id()
    FROM public.card_links l
    WHERE l.board_id = src AND card_map ? l.from_card_id::text AND card_map ? l.to_card_id::text;

    INSERT INTO public.card_field_values (card_id, board_id, field_id, value)
    SELECT (card_map ->> v.card_id::text)::uuid, b.id, (field_map ->> v.field_id::text)::uuid, v.value
    FROM public.card_field_values v
    WHERE v.board_id = src AND card_map ? v.card_id::text;
  END IF;

  INSERT INTO public.column_rules (board_id, column_id, kind, tag_id, user_id, due_days)
  SELECT b.id, (column_map ->> r.column_id::text)::uuid, r.kind, (tag_map ->> r.tag_id::text)::uuid, r.user_id, r.due_days
  FROM public.column_rules r
  WHERE r.board_id = src AND (r.user_id IS NULL OR app.is_member(b.id, r.user_id));

  RETURN b;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- recurrences

-- Viewers read schedules; editors and owners manage them. next_run_at,
-- last_run_at and created_by are kept by the trigger below and the runner.
GRANT SELECT, INSERT, UPDATE (column_id, rule, interval, weekdays, day_of_month, due_in_days, active), DELETE
  ON card_recurrences TO kanban_app;
--> statement-breakpoint
ALTER TABLE card_recurrences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_recurrences_select ON card_recurrences FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_recurrences_insert ON card_recurrences FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY card_recurrences_update ON card_recurrences FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY card_recurrences_delete ON card_recurrences FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER card_recurrences_notify AFTER INSERT OR UPDATE OR DELETE ON card_recurrences
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- The first run date on or after d (first) or the next one after the run on d.
-- daily: every step days. weekly: the given ISO weekdays, every step-th week
-- (weeks start on Monday; the rest of d's week comes first). monthly:
-- day_of_month every step months, clamped to the month's last day (31 -> 30
-- April, 28/29 February).
CREATE FUNCTION app.recurrence_next(rule public.recurrence_rule, step integer, weekdays smallint[], dom smallint, d date, first boolean)
RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $$
DECLARE
  week_start date := d - (extract(isodow FROM d)::int - 1);
  m date := date_trunc('month', d::timestamp)::date;
  candidate date;
BEGIN
  CASE rule::text
  WHEN 'daily' THEN
    RETURN CASE WHEN first THEN d ELSE d + step END;
  WHEN 'weekly' THEN
    SELECT min(week_start + w - 1) INTO candidate FROM unnest(weekdays) w
    WHERE week_start + w - 1 >= d + CASE WHEN first THEN 0 ELSE 1 END;
    IF candidate IS NOT NULL THEN
      RETURN candidate;
    END IF;
    RETURN week_start + 7 * CASE WHEN first THEN 1 ELSE step END + (SELECT min(w) FROM unnest(weekdays) w) - 1;
  ELSE
    IF NOT first THEN
      m := (m + make_interval(months => step))::date;
    END IF;
    LOOP
      candidate := m + least(dom, extract(day FROM m + interval '1 month' - interval '1 day')::int) - 1;
      EXIT WHEN candidate >= d;
      m := (m + interval '1 month')::date;
    END LOOP;
    RETURN candidate;
  END CASE;
END
$$;
--> statement-breakpoint

-- Keeps a schedule consistent: the card must be a template of the board
-- (KB008); whoever edits it through kanban_app becomes its created_by (cards
-- are created as them); a new or changed schedule, or one switched back on,
-- gets its first run date: today, or tomorrow if it already ran today. Run
-- dates are midnight in the database time zone.
CREATE FUNCTION app.schedule_card_recurrence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.cards WHERE id = NEW.template_card_id AND is_template) THEN
      RAISE EXCEPTION 'recurring cards need a template' USING ERRCODE = 'KB008';
    END IF;
    NEW.last_run_at := NULL;
  END IF;
  IF app.current_user_id() IS NOT NULL THEN
    NEW.created_by := app.current_user_id();
  END IF;
  IF TG_OP = 'INSERT'
     OR (NEW.rule, NEW.interval, NEW.weekdays, NEW.day_of_month) IS DISTINCT FROM (OLD.rule, OLD.interval, OLD.weekdays, OLD.day_of_month)
     OR (NEW.active AND NOT OLD.active) THEN
    -- Null for invalid rule fields; the check constraint then reports them.
    NEW.next_run_at := coalesce(app.recurrence_next(NEW.rule, NEW.interval, NEW.weekdays, NEW.day_of_month,
      CASE WHEN NEW.last_run_at::date >= current_date THEN current_date + 1 ELSE current_date END, true)::timestamptz, now());
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.schedule_card_recurrence() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER card_recurrences_schedule BEFORE INSERT OR UPDATE ON card_recurrences
FOR EACH ROW EXECUTE FUNCTION app.schedule_card_recurrence();
--> statement-breakpoint

-- Creates the cards of every due, active schedule (server/tasks/cards/recurring.ts,
-- every 15 minutes, as kanban_auth: the only role with EXECUTE). Rows are
-- claimed with FOR UPDATE SKIP LOCKED and advanced in the same transaction, so
-- reruns and several instances create nothing twice. Missed runs (server down)
-- collapse into one card. Each card is made as the schedule's created_by
-- (app.user_id is set for the triggers); if they can no longer edit the board
-- the schedule is switched off. Archived boards create nothing but advance.
-- A run that fails is skipped with a warning.
CREATE FUNCTION app.run_due_recurrences()
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

    IF app.board_archived(r.board_id) THEN
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.run_due_recurrences() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.run_due_recurrences() TO kanban_auth;
