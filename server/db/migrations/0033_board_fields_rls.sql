-- Custom card fields: per-board definitions and per-card values.

-- ---------------------------------------------------------------- policies

-- As tags (0006): anyone who can see the board sees its fields and values;
-- editors and owners define fields and set values. kind is fixed at creation.
GRANT SELECT, INSERT, UPDATE (name, options, position, show_on_card), DELETE ON board_fields TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (value, updated_at), DELETE ON card_field_values TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_fields ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_field_values ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_fields_select ON board_fields FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_fields_insert ON board_fields FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY board_fields_update ON board_fields FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY board_fields_delete ON board_fields FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY card_field_values_select ON card_field_values FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_field_values_insert ON card_field_values FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY card_field_values_update ON card_field_values FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY card_field_values_delete ON card_field_values FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER board_fields_notify AFTER INSERT OR UPDATE OR DELETE ON board_fields
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER card_field_values_notify AFTER INSERT OR UPDATE OR DELETE ON card_field_values
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- ---------------------------------------------------------------- validation

-- Select options: an array of { id, label, color } with unique ids (1-36
-- chars), labels of 1-50 chars and lowercase #rrggbb colours, at most 100.
-- Other kinds have no options ('[]'). KB006 -> 400.
CREATE FUNCTION app.check_board_field() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind::text <> 'select' THEN
    IF NEW.options <> '[]'::jsonb THEN
      RAISE EXCEPTION 'only select fields have options' USING ERRCODE = 'KB006';
    END IF;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.options) <> 'array' OR jsonb_array_length(NEW.options) > 100
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(NEW.options) o
       WHERE jsonb_typeof(o) <> 'object'
          OR jsonb_typeof(o -> 'id') IS DISTINCT FROM 'string'
          OR jsonb_typeof(o -> 'label') IS DISTINCT FROM 'string'
          OR jsonb_typeof(o -> 'color') IS DISTINCT FROM 'string'
          OR char_length(o ->> 'id') NOT BETWEEN 1 AND 36
          OR char_length(o ->> 'label') NOT BETWEEN 1 AND 50
          OR (o ->> 'color') !~ '^#[0-9a-f]{6}$'
     )
     OR (SELECT count(DISTINCT o ->> 'id') <> count(*) FROM jsonb_array_elements(NEW.options) o) THEN
    RAISE EXCEPTION 'invalid select options' USING ERRCODE = 'KB006';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER board_fields_check BEFORE INSERT OR UPDATE OF options ON board_fields
FOR EACH ROW EXECUTE FUNCTION app.check_board_field();
--> statement-breakpoint

-- A value must match its field's kind: text a 1-2000 char string, number a
-- JSON number, date a YYYY-MM-DD string, select one of the option ids,
-- checkbox a boolean, url an http(s) URL of up to 2000 chars. KB005 -> 400.
-- SECURITY DEFINER so the check sees the field whatever the caller's policies
-- (the composite FK still pins it to the card's board).
CREATE FUNCTION app.check_card_field_value() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  f public.board_fields;
  v jsonb := NEW.value;
  ok boolean;
BEGIN
  SELECT * INTO f FROM public.board_fields WHERE id = NEW.field_id;
  IF NOT FOUND THEN
    RETURN NEW;  -- the foreign key reports it
  END IF;
  ok := CASE f.kind::text
    WHEN 'text' THEN jsonb_typeof(v) = 'string' AND char_length(v #>> '{}') BETWEEN 1 AND 2000
    WHEN 'number' THEN jsonb_typeof(v) = 'number'
    WHEN 'date' THEN jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' AND pg_input_is_valid(v #>> '{}', 'date')
    WHEN 'select' THEN jsonb_typeof(v) = 'string' AND EXISTS (SELECT 1 FROM jsonb_array_elements(f.options) o WHERE o ->> 'id' = v #>> '{}')
    WHEN 'checkbox' THEN jsonb_typeof(v) = 'boolean'
    WHEN 'url' THEN jsonb_typeof(v) = 'string' AND char_length(v #>> '{}') <= 2000 AND (v #>> '{}') ~* '^https?://[^\s/?#]+[^\s]*$'
    ELSE false
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'invalid value for field %', f.name USING ERRCODE = 'KB005';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.check_card_field_value() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER card_field_values_check BEFORE INSERT OR UPDATE OF value ON card_field_values
FOR EACH ROW EXECUTE FUNCTION app.check_card_field_value();
--> statement-breakpoint

-- Removing a select option clears the values that used it.
CREATE FUNCTION app.clear_removed_field_options() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.card_field_values v
  WHERE v.field_id = NEW.id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.options) o WHERE o ->> 'id' = v.value #>> '{}');
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clear_removed_field_options() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER board_fields_clear_options AFTER UPDATE OF options ON board_fields
FOR EACH ROW WHEN (NEW.kind = 'select' AND OLD.options IS DISTINCT FROM NEW.options)
EXECUTE FUNCTION app.clear_removed_field_options();
--> statement-breakpoint

-- ---------------------------------------------------------------- activity

-- A value as text for the activity log: the option label for select fields,
-- otherwise the JSON scalar as text (dates YYYY-MM-DD, checkboxes true/false).
-- Null when the select option is gone.
CREATE FUNCTION app.field_value_text(f public.board_fields, v jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN v IS NULL THEN NULL
    WHEN f.kind::text = 'select' THEN (SELECT o ->> 'label' FROM jsonb_array_elements(f.options) o WHERE o ->> 'id' = v #>> '{}' LIMIT 1)
    ELSE left(v #>> '{}', 200)
  END
$$;
--> statement-breakpoint

-- Logs 'field' with data { field, kind, from, to } (display text, null = no
-- value). Values removed with their field or select option are not logged.
CREATE FUNCTION app.log_card_field_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.card_field_values := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  f public.board_fields;
  old_text text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.value = NEW.value THEN
    RETURN NULL;
  END IF;
  SELECT * INTO f FROM public.board_fields WHERE id = r.field_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_text := app.field_value_text(f, OLD.value);
    IF TG_OP = 'DELETE' AND old_text IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM app.log_activity(r.card_id, r.board_id, 'field', jsonb_build_object(
    'field', f.name, 'kind', f.kind, 'from', old_text,
    'to', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE app.field_value_text(f, NEW.value) END));
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.log_card_field_activity() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER card_field_values_log_activity AFTER INSERT OR UPDATE OF value OR DELETE ON card_field_values
FOR EACH ROW EXECUTE FUNCTION app.log_card_field_activity();
--> statement-breakpoint

-- ---------------------------------------------------------------- copy board

-- As in 0031, plus field definitions (option ids kept, so values copy as
-- they are) and, with cards, their values.
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
