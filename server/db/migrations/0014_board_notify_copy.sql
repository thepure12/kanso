-- ---------------------------------------------------------------- realtime
-- Every change to a board's data sends NOTIFY board_changes with
-- {"b": board id, "c": client id}. The client id comes from the transaction
-- setting app.client_id (one per browser tab), so a tab can ignore its own
-- changes. The payload carries no board data: listeners refetch the board
-- through RLS. Postgres drops duplicate payloads within one transaction, so a
-- statement that touches many rows sends one notification per board.
--
-- TG_ARGV[0] names the column that holds the board id, or the team id when
-- TG_ARGV[1] = 'team' (then every board of that team is notified).

CREATE FUNCTION app.notify_board_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  rec jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  client text := coalesce(current_setting('app.client_id', true), '');
  b uuid;
BEGIN
  IF TG_ARGV[1] = 'team' THEN
    FOR b IN SELECT id FROM public.boards WHERE team_id = (rec ->> TG_ARGV[0])::uuid LOOP
      PERFORM pg_notify('board_changes', json_build_object('b', b, 'c', client)::text);
    END LOOP;
  ELSE
    PERFORM pg_notify('board_changes', json_build_object('b', rec ->> TG_ARGV[0], 'c', client)::text);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.notify_board_change() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER boards_notify AFTER INSERT OR UPDATE OR DELETE ON boards
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('id');
--> statement-breakpoint
CREATE TRIGGER teams_notify AFTER UPDATE ON teams
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('id', 'team');
--> statement-breakpoint
CREATE TRIGGER team_members_notify AFTER INSERT OR UPDATE OR DELETE ON team_members
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('team_id', 'team');
--> statement-breakpoint
CREATE TRIGGER board_members_notify AFTER INSERT OR UPDATE OR DELETE ON board_members
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER columns_notify AFTER INSERT OR UPDATE OR DELETE ON columns
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER column_rules_notify AFTER INSERT OR UPDATE OR DELETE ON column_rules
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER cards_notify AFTER INSERT OR UPDATE OR DELETE ON cards
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER tags_notify AFTER INSERT OR UPDATE OR DELETE ON tags
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER card_tags_notify AFTER INSERT OR UPDATE OR DELETE ON card_tags
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER card_assignees_notify AFTER INSERT OR UPDATE OR DELETE ON card_assignees
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER checklist_items_notify AFTER INSERT OR UPDATE OR DELETE ON checklist_items
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER card_comments_notify AFTER INSERT OR UPDATE OR DELETE ON card_comments
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER card_attachments_notify AFTER INSERT OR UPDATE OR DELETE ON card_attachments
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- ---------------------------------------------------------------- copy board

-- Copies a board's columns, tags and rules (and, with with_cards, its
-- unarchived cards with their tags, assignees and checklists) into a new board.
-- SECURITY INVOKER: the caller reads the source and writes the copy through
-- the normal policies, so it needs access to the source and the right to
-- create the new board (app.create_board checks that). People without access
-- to the new board are left out of assign_to rules and assignees.
-- Cards go in before the rules, so the rules do not run on copied cards.
-- Comments, attachments and activity are not copied.
CREATE FUNCTION app.copy_board(src uuid, board_name text, team uuid, with_cards boolean)
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
      SELECT id AS old_id, gen_random_uuid() AS new_id, column_id, title, description, position, due_date, priority
      FROM public.cards WHERE board_id = src AND archived_at IS NULL
    ), ins AS (
      INSERT INTO public.cards (id, board_id, column_id, title, description, position, due_date, priority, created_by)
      SELECT new_id, b.id, (column_map ->> column_id::text)::uuid, title, description, position, due_date, priority,
             app.current_user_id()
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
  END IF;

  INSERT INTO public.column_rules (board_id, column_id, kind, tag_id, user_id, due_days)
  SELECT b.id, (column_map ->> r.column_id::text)::uuid, r.kind, (tag_map ->> r.tag_id::text)::uuid, r.user_id, r.due_days
  FROM public.column_rules r
  WHERE r.board_id = src AND (r.user_id IS NULL OR app.is_member(b.id, r.user_id));

  RETURN b;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.copy_board(uuid, text, uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.copy_board(uuid, text, uuid, boolean) TO kanban_app;
