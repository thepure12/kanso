-- Named checklists (0099): several per card, items belong to one.
-- Card-child policies as checklist_items (0012, 0088): readers of the card
-- read, people who may edit the card manage. Items may move between the
-- checklists of their card (composite FK keeps them on the card).
GRANT SELECT, INSERT, DELETE ON checklists TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (name, position) ON checklists TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (checklist_id) ON checklist_items TO kanban_app;
--> statement-breakpoint
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY checklists_select ON checklists FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
CREATE POLICY checklists_insert ON checklists FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
CREATE POLICY checklists_update ON checklists FOR UPDATE TO kanban_app
  USING (app.can_edit_card(card_id)) WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
CREATE POLICY checklists_delete ON checklists FOR DELETE TO kanban_app
  USING (app.can_edit_card(card_id));
--> statement-breakpoint
CREATE TRIGGER checklists_notify AFTER INSERT OR UPDATE OR DELETE ON checklists
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- An item inserted without a checklist (older clients, scripts) goes into the
-- card's first checklist, created as "Checklist" when the card has none.
-- SECURITY INVOKER: the insert goes through the caller's checklists policy.
CREATE FUNCTION app.checklist_items_default_list() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  SELECT id INTO NEW.checklist_id FROM public.checklists
  WHERE card_id = NEW.card_id ORDER BY position, created_at, id LIMIT 1;
  IF NEW.checklist_id IS NULL THEN
    INSERT INTO public.checklists (card_id, board_id, name, position)
    VALUES (NEW.card_id, NEW.board_id, 'Checklist', 1024)
    RETURNING id INTO NEW.checklist_id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_default_list BEFORE INSERT ON checklist_items
FOR EACH ROW WHEN (NEW.checklist_id IS NULL) EXECUTE FUNCTION app.checklist_items_default_list();
--> statement-breakpoint

-- As in 0037, plus the card's checklists (names, order) with their items unticked.
CREATE OR REPLACE FUNCTION app.copy_card(src uuid, target_column uuid, as_template boolean, with_assignees boolean,
  due_in_days integer DEFAULT NULL, card_title text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public
AS $$
DECLARE
  s public.cards;
  new_id uuid;
  checklist_map jsonb;
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

  WITH m AS (
    SELECT cl.id AS old_list, gen_random_uuid() AS new_list, cl.name AS list_name, cl.position AS list_position
    FROM public.checklists cl WHERE cl.card_id = src
  ), ins AS (
    INSERT INTO public.checklists (id, card_id, board_id, name, position)
    SELECT m.new_list, new_id, s.board_id, m.list_name, m.list_position FROM m
  )
  SELECT coalesce(jsonb_object_agg(m.old_list, m.new_list), '{}') INTO checklist_map FROM m;

  INSERT INTO public.checklist_items (card_id, board_id, checklist_id, text, done, position)
  SELECT new_id, s.board_id, (checklist_map ->> ci.checklist_id::text)::uuid, ci.text, false, ci.position
  FROM public.checklist_items ci WHERE ci.card_id = src;

  INSERT INTO public.card_field_values (card_id, board_id, field_id, value)
  SELECT new_id, s.board_id, v.field_id, v.value
  FROM public.card_field_values v WHERE v.card_id = src;

  RETURN new_id;
END
$$;
--> statement-breakpoint

-- As in 0062, plus checklists.
CREATE OR REPLACE FUNCTION app.copy_board(src uuid, board_name text, team uuid, with_cards boolean)
RETURNS public.boards
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public
AS $$
DECLARE
  b public.boards;
  column_map jsonb;
  tag_map jsonb;
  field_map jsonb;
  group_map jsonb;
  card_map jsonb;
  checklist_map jsonb;
BEGIN
  IF app.board_role(src) IS NULL THEN
    RAISE EXCEPTION 'no access to the source board' USING ERRCODE = '42501';
  END IF;
  b := app.create_board(board_name, team);

  WITH m AS (
    SELECT id AS old_id, gen_random_uuid() AS new_id, title, position, color, wip_limit, outline
    FROM public.columns WHERE board_id = src
  ), ins AS (
    INSERT INTO public.columns (id, board_id, title, position, color, wip_limit, outline)
    SELECT new_id, b.id, title, position, color, wip_limit, outline FROM m
  )
  SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO column_map FROM m;

  WITH m AS (
    SELECT id AS old_id, gen_random_uuid() AS new_id, name, color, position
    FROM public.column_groups WHERE board_id = src
  ), ins AS (
    INSERT INTO public.column_groups (id, board_id, name, color, position)
    SELECT new_id, b.id, name, color, position FROM m
  )
  SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO group_map FROM m;

  INSERT INTO public.column_group_members (group_id, column_id, board_id)
  SELECT (group_map ->> g.group_id::text)::uuid, (column_map ->> g.column_id::text)::uuid, b.id
  FROM public.column_group_members g
  WHERE g.board_id = src;

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

    WITH m AS (
      SELECT id AS old_id, gen_random_uuid() AS new_id, card_id, name, position
      FROM public.checklists WHERE board_id = src AND card_map ? card_id::text
    ), ins AS (
      INSERT INTO public.checklists (id, card_id, board_id, name, position)
      SELECT new_id, (card_map ->> card_id::text)::uuid, b.id, name, position FROM m
    )
    SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO checklist_map FROM m;

    INSERT INTO public.checklist_items (card_id, board_id, checklist_id, text, done, position)
    SELECT (card_map ->> ci.card_id::text)::uuid, b.id, (checklist_map ->> ci.checklist_id::text)::uuid, ci.text, ci.done, ci.position
    FROM public.checklist_items ci
    WHERE ci.board_id = src AND checklist_map ? ci.checklist_id::text;

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
