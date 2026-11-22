-- Button tooltips: managed like the name (shared ones by editors, personal
-- ones by their user; the existing policies decide).
GRANT UPDATE (tooltip) ON board_buttons TO kanban_app;
--> statement-breakpoint

-- As in 0126, but shared buttons keep their tooltip in the copy.
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
  assignee_group_map jsonb;
  card_map jsonb;
  checklist_map jsonb;
  button_map jsonb;
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
    SELECT id AS old_id, gen_random_uuid() AS new_id, name
    FROM public.assignee_groups WHERE board_id = src
  ), ins AS (
    INSERT INTO public.assignee_groups (id, board_id, name)
    SELECT new_id, b.id, name FROM m
  )
  SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO assignee_group_map FROM m;

  INSERT INTO public.assignee_group_members (group_id, board_id, user_id)
  SELECT (assignee_group_map ->> g.group_id::text)::uuid, b.id, g.user_id
  FROM public.assignee_group_members g
  WHERE g.board_id = src AND app.is_member(b.id, g.user_id);

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

  WITH m AS (
    SELECT bb.id AS old_id, gen_random_uuid() AS new_id, bb.*
    FROM public.board_buttons bb
    WHERE bb.board_id = src AND bb.user_id IS NULL
  ), ins AS (
    INSERT INTO public.board_buttons (id, board_id, user_id, scope, name, icon, color, tooltip, column_ids, steps, created_by)
    SELECT m.new_id, b.id, NULL, m.scope, m.name, m.icon, m.color, m.tooltip,
           CASE WHEN m.column_ids IS NULL THEN NULL ELSE
             coalesce((SELECT array_agg((column_map ->> c::text)::uuid) FROM unnest(m.column_ids) c WHERE column_map ? c::text), '{}') END,
           (SELECT jsonb_agg(s || jsonb_strip_nulls(jsonb_build_object(
                      'columnId', column_map -> (s ->> 'columnId'),
                      'tagId', tag_map -> (s ->> 'tagId'),
                      'from', column_map -> (s ->> 'from'),
                      'to', column_map -> (s ->> 'to'))) ORDER BY e.ord)
            FROM jsonb_array_elements(m.steps) WITH ORDINALITY AS e(s, ord)),
           app.current_user_id()
    FROM m
  )
  SELECT coalesce(jsonb_object_agg(old_id, new_id), '{}') INTO button_map FROM m;

  IF with_cards THEN
    INSERT INTO public.board_button_cards (button_id, card_id, board_id)
    SELECT (button_map ->> bc.button_id::text)::uuid, (card_map ->> bc.card_id::text)::uuid, b.id
    FROM public.board_button_cards bc
    WHERE bc.board_id = src AND button_map ? bc.button_id::text AND card_map ? bc.card_id::text;
  END IF;

  INSERT INTO public.column_rules (board_id, column_id, kind, tag_id, user_id, due_days, button_id)
  SELECT b.id, (column_map ->> r.column_id::text)::uuid, r.kind, (tag_map ->> r.tag_id::text)::uuid, r.user_id, r.due_days,
         (button_map ->> r.button_id::text)::uuid
  FROM public.column_rules r
  WHERE r.board_id = src AND (r.user_id IS NULL OR app.is_member(b.id, r.user_id))
    AND (r.button_id IS NULL OR button_map ? r.button_id::text);

  RETURN b;
END
$$;
