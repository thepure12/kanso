-- Card watchers and card links (dependencies).

-- ---------------------------------------------------------------- watchers

-- Anyone who can see the board sees who watches a card, and watches or
-- unwatches it for themselves only. Rows outlive board access (like
-- assignments); notifications skip people who lost it.
GRANT SELECT, INSERT, DELETE ON card_watchers TO kanban_app;
--> statement-breakpoint
ALTER TABLE card_watchers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_watchers_select ON card_watchers FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_watchers_insert ON card_watchers FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_watchers_delete ON card_watchers FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE TRIGGER card_watchers_notify AFTER INSERT OR UPDATE OR DELETE ON card_watchers
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- Auto-watch: a card's creator and everyone who comments on it. Idempotent.
-- Cards of a board created in the same transaction (a copy or an import) are
-- skipped, so copying a board does not make the copier watch every card.
CREATE FUNCTION app.auto_watch_card() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  card uuid;
  watcher uuid;
BEGIN
  IF TG_TABLE_NAME = 'cards' THEN
    card := NEW.id;
    watcher := NEW.created_by;
  ELSE
    card := NEW.card_id;
    watcher := NEW.author_id;
  END IF;
  IF watcher IS NULL
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND created_at = now()) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.card_watchers (card_id, board_id, user_id)
  VALUES (card, NEW.board_id, watcher)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auto_watch_card() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER cards_auto_watch AFTER INSERT ON cards
FOR EACH ROW EXECUTE FUNCTION app.auto_watch_card();
--> statement-breakpoint
CREATE TRIGGER card_comments_auto_watch AFTER INSERT ON card_comments
FOR EACH ROW EXECUTE FUNCTION app.auto_watch_card();
--> statement-breakpoint

-- As in 0024, plus watchers: they get what assignees get ('assigned' still
-- reaches only the assigned person). UNION dedupes people who are both.
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND created_at = now()) THEN
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

-- ---------------------------------------------------------------- links

-- Viewers read links; editors and owners add them (as themselves) and remove them.
GRANT SELECT, INSERT, DELETE ON card_links TO kanban_app;
--> statement-breakpoint
ALTER TABLE card_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_links_select ON card_links FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_links_insert ON card_links FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY card_links_delete ON card_links FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER card_links_notify AFTER INSERT OR UPDATE OR DELETE ON card_links
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- Rejects a 'blocks' link that closes a cycle (to_card already blocks
-- from_card, directly or through other cards). AFTER ROW, so rows inserted
-- earlier in the same statement are visible; the advisory lock serialises
-- concurrent link inserts on one board so two halves of a cycle cannot both pass.
CREATE FUNCTION app.check_card_link_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('card_links'), hashtext(NEW.board_id::text));
  IF EXISTS (
    WITH RECURSIVE reach(card_id) AS (
      SELECT NEW.to_card_id
      UNION
      SELECT l.to_card_id FROM public.card_links l JOIN reach r ON l.from_card_id = r.card_id
      WHERE l.kind = 'blocks'
    )
    SELECT 1 FROM reach WHERE card_id = NEW.from_card_id
  ) THEN
    RAISE EXCEPTION 'blocking links cannot form a cycle' USING ERRCODE = 'KB004';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.check_card_link_cycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER card_links_check_cycle AFTER INSERT ON card_links
FOR EACH ROW WHEN (NEW.kind = 'blocks') EXECUTE FUNCTION app.check_card_link_cycle();
--> statement-breakpoint

-- Logs 'linked' / 'unlinked' on both cards. data: kind, direction ('out' on
-- from_card, 'in' on to_card), the other card's id and title. Skipped when
-- either card is gone (links deleted by a card's cascade).
CREATE FUNCTION app.log_card_link_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.card_links := CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
  verb text := CASE WHEN TG_OP = 'INSERT' THEN 'linked' ELSE 'unlinked' END;
  from_title text;
  to_title text;
BEGIN
  SELECT title INTO from_title FROM public.cards WHERE id = r.from_card_id;
  SELECT title INTO to_title FROM public.cards WHERE id = r.to_card_id;
  IF from_title IS NULL OR to_title IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM app.log_activity(r.from_card_id, r.board_id, verb, jsonb_build_object(
    'kind', r.kind, 'direction', 'out', 'card_id', r.to_card_id, 'card', to_title));
  PERFORM app.log_activity(r.to_card_id, r.board_id, verb, jsonb_build_object(
    'kind', r.kind, 'direction', 'in', 'card_id', r.from_card_id, 'card', from_title));
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.log_card_link_activity() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER card_links_log_activity AFTER INSERT OR DELETE ON card_links
FOR EACH ROW EXECUTE FUNCTION app.log_card_link_activity();
--> statement-breakpoint

-- ---------------------------------------------------------------- copy board

-- As in 0029, plus links between copied (unarchived) cards. Watchers are not
-- copied.
CREATE OR REPLACE FUNCTION app.copy_board(src uuid, board_name text, team uuid, with_cards boolean)
RETURNS public.boards
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public
AS $$
DECLARE
  b public.boards;
  column_map jsonb;
  tag_map jsonb;
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

  IF with_cards THEN
    WITH m AS (
      SELECT id AS old_id, gen_random_uuid() AS new_id, column_id, title, description, position,
             start_date, due_date, priority, estimate
      FROM public.cards WHERE board_id = src AND archived_at IS NULL
    ), ins AS (
      INSERT INTO public.cards (id, board_id, column_id, title, description, position, start_date, due_date, priority, estimate, created_by)
      SELECT new_id, b.id, (column_map ->> column_id::text)::uuid, title, description, position,
             start_date, due_date, priority, estimate, app.current_user_id()
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
  END IF;

  INSERT INTO public.column_rules (board_id, column_id, kind, tag_id, user_id, due_days)
  SELECT b.id, (column_map ->> r.column_id::text)::uuid, r.kind, (tag_map ->> r.tag_id::text)::uuid, r.user_id, r.due_days
  FROM public.column_rules r
  WHERE r.board_id = src AND (r.user_id IS NULL OR app.is_member(b.id, r.user_id));

  RETURN b;
END
$$;
