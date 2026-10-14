-- Card start date, estimate and cover image, plus time tracking.

-- ---------------------------------------------------------------- time entries

-- Anyone who can see the board reads the entries. Editors and owners log time
-- as themselves and edit their own entries while they can still edit the
-- board; authors and board owners delete them (like card_comments).
GRANT SELECT, INSERT, UPDATE (minutes, spent_on, note), DELETE ON time_entries TO kanban_app;
--> statement-breakpoint
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entries_select ON time_entries FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY time_entries_insert ON time_entries FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY time_entries_update ON time_entries FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id() AND app.can_edit(board_id))
  WITH CHECK (user_id = app.current_user_id() AND app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY time_entries_delete ON time_entries FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner' OR (user_id = app.current_user_id() AND app.can_edit(board_id)));
--> statement-breakpoint
CREATE TRIGGER time_entries_notify AFTER INSERT OR UPDATE OR DELETE ON time_entries
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- ---------------------------------------------------------------- cover image

-- A card's cover must be an image attachment of that same card. Types match
-- the ones GET /api/attachments/:id shows inline (no SVG). Deleting the
-- attachment clears the cover (FK ON DELETE SET NULL). SECURITY DEFINER so the
-- check sees the attachment whatever the caller's policies.
CREATE FUNCTION app.check_card_cover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.cover_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.card_attachments a
    WHERE a.id = NEW.cover_attachment_id AND a.card_id = NEW.id
      AND a.content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
  ) THEN
    RAISE EXCEPTION 'the cover must be an image attached to this card' USING ERRCODE = 'KB003';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.check_card_cover() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER cards_check_cover
BEFORE INSERT OR UPDATE OF cover_attachment_id ON cards
FOR EACH ROW EXECUTE FUNCTION app.check_card_cover();
--> statement-breakpoint

-- ---------------------------------------------------------------- set_due rule

-- As in 0012, but a due date set by a rule pulls a later start date back to it,
-- so cards_start_before_due never blocks a move.
CREATE OR REPLACE FUNCTION app.set_column_rule_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  days integer;
BEGIN
  IF TG_OP = 'INSERT' OR OLD.column_id IS DISTINCT FROM NEW.column_id THEN
    SELECT r.due_days INTO days
    FROM public.column_rules r
    WHERE r.column_id = NEW.column_id AND r.kind::text = 'set_due';
    IF FOUND THEN
      NEW.due_date := current_date + days;
      IF NEW.start_date > NEW.due_date THEN
        NEW.start_date := NEW.due_date;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- activity

-- As in 0012, plus 'start' and 'estimate'. Cover changes are not logged.
CREATE OR REPLACE FUNCTION app.log_card_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'created',
      jsonb_build_object('column', (SELECT title FROM public.columns WHERE id = NEW.column_id)));
    RETURN NULL;
  END IF;
  IF OLD.column_id IS DISTINCT FROM NEW.column_id THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'moved', jsonb_build_object(
      'from', (SELECT title FROM public.columns WHERE id = OLD.column_id),
      'to', (SELECT title FROM public.columns WHERE id = NEW.column_id)));
  END IF;
  IF OLD.title IS DISTINCT FROM NEW.title THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'renamed', jsonb_build_object('from', OLD.title, 'to', NEW.title));
  END IF;
  IF OLD.description IS DISTINCT FROM NEW.description THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'described');
  END IF;
  IF OLD.start_date IS DISTINCT FROM NEW.start_date THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'start', jsonb_build_object('to', NEW.start_date));
  END IF;
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'due', jsonb_build_object('to', NEW.due_date));
  END IF;
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'priority', jsonb_build_object('to', NEW.priority));
  END IF;
  IF OLD.estimate IS DISTINCT FROM NEW.estimate THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'estimate', jsonb_build_object('to', NEW.estimate::text));
  END IF;
  IF (OLD.archived_at IS NULL) <> (NEW.archived_at IS NULL) THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, CASE WHEN NEW.archived_at IS NULL THEN 'restored' ELSE 'archived' END);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER cards_log_activity ON cards;
--> statement-breakpoint
CREATE TRIGGER cards_log_activity
AFTER INSERT OR UPDATE OF column_id, title, description, start_date, due_date, priority, estimate, archived_at ON cards
FOR EACH ROW EXECUTE FUNCTION app.log_card_activity();
--> statement-breakpoint

-- ---------------------------------------------------------------- copy board

-- As in 0014, plus start_date and estimate. Covers (attachments) and time
-- entries are not copied.
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
  END IF;

  INSERT INTO public.column_rules (board_id, column_id, kind, tag_id, user_id, due_days)
  SELECT b.id, (column_map ->> r.column_id::text)::uuid, r.kind, (tag_map ->> r.tag_id::text)::uuid, r.user_id, r.due_days
  FROM public.column_rules r
  WHERE r.board_id = src AND (r.user_id IS NULL OR app.is_member(b.id, r.user_id));

  RETURN b;
END
$$;
