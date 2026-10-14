-- Card features: several assignees, checklists, comments, attachments and an
-- activity log, plus the remove_tag and set_due column rules.
--
-- Every new table carries board_id with a composite FK to cards (id, board_id),
-- so its policies can check the board directly, like card_tags.
-- Anyone who can see the board reads these rows; editors and owners write them.
-- New rule kinds are compared as kind::text: drizzle-kit runs this file in the
-- same transaction that added them to the enum.

-- ---------------------------------------------------------------- assignees

-- Copy the single assignee into the new table. The column itself is dropped in
-- the next migration, after the policies below stop referring to it.
INSERT INTO card_assignees (card_id, user_id, board_id)
SELECT id, assignee_id, board_id FROM cards WHERE assignee_id IS NOT NULL;
--> statement-breakpoint

DROP POLICY cards_insert ON cards;
--> statement-breakpoint
CREATE POLICY cards_insert ON cards FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id());
--> statement-breakpoint
DROP POLICY cards_update ON cards;
--> statement-breakpoint
CREATE POLICY cards_update ON cards FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint

-- ---------------------------------------------------------------- grants

GRANT SELECT, INSERT, DELETE ON card_assignees TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (text, done, position), DELETE ON checklist_items TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (body), DELETE ON card_comments TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON card_attachments TO kanban_app;
--> statement-breakpoint
-- Written by triggers only.
GRANT SELECT ON card_activity TO kanban_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- policies

ALTER TABLE card_assignees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_activity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Only people with access to the board can be assigned. If they lose access
-- later, the assignment stays until someone removes it.
CREATE POLICY card_assignees_select ON card_assignees FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_assignees_insert ON card_assignees FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND app.is_member(board_id, user_id));
--> statement-breakpoint
CREATE POLICY card_assignees_delete ON card_assignees FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint

CREATE POLICY checklist_items_select ON checklist_items FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY checklist_items_insert ON checklist_items FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY checklist_items_update ON checklist_items FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY checklist_items_delete ON checklist_items FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint

-- Editors and owners comment as themselves. Authors edit their own comments
-- while they can still edit the board; authors and board owners delete them.
CREATE POLICY card_comments_select ON card_comments FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_comments_insert ON card_comments FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND author_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY card_comments_update ON card_comments FOR UPDATE TO kanban_app
  USING (author_id = app.current_user_id() AND app.can_edit(board_id))
  WITH CHECK (author_id = app.current_user_id() AND app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY card_comments_delete ON card_comments FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner' OR (author_id = app.current_user_id() AND app.can_edit(board_id)));
--> statement-breakpoint
CREATE TRIGGER card_comments_touch_updated_at
BEFORE UPDATE ON card_comments
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint

CREATE POLICY card_attachments_select ON card_attachments FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY card_attachments_insert ON card_attachments FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND uploaded_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY card_attachments_delete ON card_attachments FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint

CREATE POLICY card_activity_select ON card_activity FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------- column rules

-- assign_to now adds an assignee, so a column may have several of them
-- (column_rules_column_kind_user_unique stops duplicates).
-- AFTER trigger: runs the rules that touch other tables. SECURITY INVOKER, so
-- the inserts and deletes go through the card_tags / card_assignees policies as
-- the caller. assign_to skips people who lost access to the board (the insert
-- policy would reject them and block the move).
CREATE OR REPLACE FUNCTION app.apply_column_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.column_id IS DISTINCT FROM NEW.column_id THEN
    INSERT INTO public.card_tags (card_id, tag_id, board_id)
    SELECT NEW.id, r.tag_id, NEW.board_id
    FROM public.column_rules r
    WHERE r.column_id = NEW.column_id AND r.kind::text = 'apply_tag'
    ON CONFLICT DO NOTHING;

    DELETE FROM public.card_tags ct
    USING public.column_rules r
    WHERE ct.card_id = NEW.id AND ct.tag_id = r.tag_id
      AND r.column_id = NEW.column_id AND r.kind::text = 'remove_tag';

    INSERT INTO public.card_assignees (card_id, user_id, board_id)
    SELECT NEW.id, r.user_id, NEW.board_id
    FROM public.column_rules r
    WHERE r.column_id = NEW.column_id AND r.kind::text = 'assign_to'
      AND app.is_member(NEW.board_id, r.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- BEFORE trigger: rules that change the card row itself (set_due), so the
-- cards policies check the final row. Same firing rule as above.
DROP TRIGGER cards_assign_column_rules ON cards;
--> statement-breakpoint
DROP FUNCTION app.assign_column_rules();
--> statement-breakpoint
CREATE FUNCTION app.set_column_rule_fields() RETURNS trigger
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
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.set_column_rule_fields() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.set_column_rule_fields() TO kanban_app;
--> statement-breakpoint
CREATE TRIGGER cards_set_column_rule_fields
BEFORE INSERT OR UPDATE OF column_id ON cards
FOR EACH ROW EXECUTE FUNCTION app.set_column_rule_fields();
--> statement-breakpoint

-- ---------------------------------------------------------------- activity

-- Appends to a card's activity log as the current user. SECURITY DEFINER and
-- not executable by kanban_app: only the triggers below write the log.
-- Skipped when the card is gone, e.g. card_tags rows deleted by the card's own
-- cascade. clock_timestamp() keeps entries of one transaction in order.
CREATE FUNCTION app.log_activity(card uuid, board uuid, activity_kind text, activity_data jsonb DEFAULT '{}')
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.card_activity (card_id, board_id, actor_id, kind, data, created_at)
  SELECT card, board, app.current_user_id(), activity_kind, activity_data, clock_timestamp()
  WHERE EXISTS (SELECT 1 FROM public.cards WHERE id = card)
$$;
--> statement-breakpoint

CREATE FUNCTION app.log_card_activity() RETURNS trigger
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
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'due', jsonb_build_object('to', NEW.due_date));
  END IF;
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'priority', jsonb_build_object('to', NEW.priority));
  END IF;
  IF (OLD.archived_at IS NULL) <> (NEW.archived_at IS NULL) THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, CASE WHEN NEW.archived_at IS NULL THEN 'restored' ELSE 'archived' END);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cards_log_activity
AFTER INSERT OR UPDATE OF column_id, title, description, due_date, priority, archived_at ON cards
FOR EACH ROW EXECUTE FUNCTION app.log_card_activity();
--> statement-breakpoint

-- Tag removals caused by deleting the tag itself are not logged.
CREATE FUNCTION app.log_card_tag_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  tag_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT name INTO tag_name FROM public.tags WHERE id = NEW.tag_id;
    PERFORM app.log_activity(NEW.card_id, NEW.board_id, 'tagged', jsonb_build_object('tag', tag_name));
  ELSE
    SELECT name INTO tag_name FROM public.tags WHERE id = OLD.tag_id;
    IF FOUND THEN
      PERFORM app.log_activity(OLD.card_id, OLD.board_id, 'untagged', jsonb_build_object('tag', tag_name));
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_tags_log_activity
AFTER INSERT OR DELETE ON card_tags
FOR EACH ROW EXECUTE FUNCTION app.log_card_tag_activity();
--> statement-breakpoint

CREATE FUNCTION app.log_card_assignee_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.card_assignees := CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
BEGIN
  PERFORM app.log_activity(r.card_id, r.board_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'assigned' ELSE 'unassigned' END,
    jsonb_build_object('user', (SELECT name FROM public.users WHERE id = r.user_id)));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_assignees_log_activity
AFTER INSERT OR DELETE ON card_assignees
FOR EACH ROW EXECUTE FUNCTION app.log_card_assignee_activity();
--> statement-breakpoint

CREATE FUNCTION app.log_card_comment_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.log_activity(NEW.card_id, NEW.board_id, 'commented');
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_comments_log_activity
AFTER INSERT ON card_comments
FOR EACH ROW EXECUTE FUNCTION app.log_card_comment_activity();
--> statement-breakpoint

CREATE FUNCTION app.log_card_attachment_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.card_attachments := CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
BEGIN
  PERFORM app.log_activity(r.card_id, r.board_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'attached' ELSE 'detached' END,
    jsonb_build_object('name', r.name));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_attachments_log_activity
AFTER INSERT OR DELETE ON card_attachments
FOR EACH ROW EXECUTE FUNCTION app.log_card_attachment_activity();
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.log_activity(uuid, uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.log_card_activity(), app.log_card_tag_activity(), app.log_card_assignee_activity(),
  app.log_card_comment_activity(), app.log_card_attachment_activity() FROM PUBLIC;
