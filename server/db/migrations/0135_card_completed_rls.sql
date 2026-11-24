-- Completed cards (0134: cards.completed_at, never on templates).
-- Marking a card complete does not move it: the board shows it as done. Set
-- and cleared through the card PATCH under the normal cards policies (editors
-- of the card), so no policy changes. Completing logs `completed`, reopening
-- logs `reopened` (no notifications), and completing queues the board rule
-- event `card_completed`, which runs only when the card is still complete at
-- commit. The new enum value is compared as text: it cannot be used as a
-- literal in the transaction that adds it.

-- ---------------------------------------------------------------- activity

-- As in 0094, plus completed / reopened.
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
  IF (OLD.completed_at IS NULL) <> (NEW.completed_at IS NULL) THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, CASE WHEN NEW.completed_at IS NULL THEN 'reopened' ELSE 'completed' END);
  END IF;
  IF OLD.snoozed_until IS DISTINCT FROM NEW.snoozed_until THEN
    IF NEW.snoozed_until IS NULL THEN
      PERFORM app.log_activity(NEW.id, NEW.board_id, 'woke');
    ELSE
      PERFORM app.log_activity(NEW.id, NEW.board_id, 'snoozed', jsonb_build_object('until', NEW.snoozed_until));
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER cards_log_activity ON cards;
--> statement-breakpoint
CREATE TRIGGER cards_log_activity
AFTER INSERT OR UPDATE OF column_id, title, description, start_date, due_date, priority, estimate, archived_at, snoozed_until, completed_at ON cards
FOR EACH ROW EXECUTE FUNCTION app.log_card_activity();
--> statement-breakpoint

-- ---------------------------------------------------------------- board rules

-- As in 0096, plus card_completed.
CREATE OR REPLACE FUNCTION app.cards_queue_rule_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'card_created');
    IF NEW.due_date IS NOT NULL THEN
      PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'due_set');
    END IF;
  ELSE
    IF NEW.column_id IS DISTINCT FROM OLD.column_id THEN
      PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'card_moved');
    END IF;
    IF NEW.due_date IS NOT NULL AND NEW.due_date IS DISTINCT FROM OLD.due_date THEN
      PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'due_set');
    END IF;
    IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
      PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'card_completed');
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER cards_queue_rule_events ON cards;
--> statement-breakpoint
CREATE TRIGGER cards_queue_rule_events AFTER INSERT OR UPDATE OF column_id, due_date, completed_at ON cards
FOR EACH ROW WHEN (NOT NEW.is_template) EXECUTE FUNCTION app.cards_queue_rule_events();
--> statement-breakpoint

-- As in 0096, plus: card_completed runs only while the card is still complete.
CREATE OR REPLACE FUNCTION app.run_board_rule_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  e public.board_rule_events := NEW;
  r public.board_rules;
  c public.cards;
  prev_user text := coalesce(current_setting('app.user_id', true), '');
  prev_automation text := coalesce(current_setting('app.automation', true), '');
  prev_client text := coalesce(current_setting('app.client_id', true), '');
  due date;
BEGIN
  DELETE FROM public.board_rule_events WHERE id = e.id;
  IF NOT EXISTS (SELECT 1 FROM public.boards WHERE id = e.board_id AND archived_at IS NULL AND created_at <> now())
     OR NOT EXISTS (SELECT 1 FROM public.cards WHERE id = e.card_id AND NOT is_template AND deleted_at IS NULL AND archived_at IS NULL)
     OR (e.event = 'checklist_completed' AND (
       NOT EXISTS (SELECT 1 FROM public.checklist_items WHERE card_id = e.card_id)
       OR EXISTS (SELECT 1 FROM public.checklist_items WHERE card_id = e.card_id AND NOT done)))
     OR (e.event::text = 'card_completed'
       AND NOT EXISTS (SELECT 1 FROM public.cards WHERE id = e.card_id AND completed_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.rules_running', 'on', true);
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.automation', 'on', true);
  PERFORM set_config('app.client_id', '', true);
  FOR r IN
    SELECT * FROM public.board_rules
    WHERE board_id = e.board_id AND active AND event = e.event
      AND (event_tag_id IS NULL OR event_tag_id = e.tag_id)
      AND (event_user_id IS NULL OR event_user_id = e.user_id)
    ORDER BY created_at, id
  LOOP
    SELECT * INTO c FROM public.cards WHERE id = e.card_id AND deleted_at IS NULL AND archived_at IS NULL;
    EXIT WHEN NOT FOUND;
    CONTINUE WHEN (r.cond_tag_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.card_tags WHERE card_id = c.id AND tag_id = r.cond_tag_id))
      OR (r.cond_priority IS NOT NULL AND c.priority IS DISTINCT FROM r.cond_priority)
      OR (r.cond_column_id IS NOT NULL AND c.column_id <> r.cond_column_id)
      OR (r.cond_assignee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.card_assignees WHERE card_id = c.id AND user_id = r.cond_assignee_id));
    BEGIN
      IF r.move_column_id IS NOT NULL AND r.move_column_id <> c.column_id THEN
        UPDATE public.cards SET column_id = r.move_column_id,
          position = coalesce((SELECT max(position) FROM public.cards WHERE column_id = r.move_column_id), 0) + 1024
        WHERE id = c.id;
      END IF;
      IF r.add_tag_id IS NOT NULL THEN
        INSERT INTO public.card_tags (card_id, tag_id, board_id) VALUES (c.id, r.add_tag_id, c.board_id)
        ON CONFLICT DO NOTHING;
      END IF;
      IF r.remove_tag_id IS NOT NULL THEN
        DELETE FROM public.card_tags WHERE card_id = c.id AND tag_id = r.remove_tag_id;
      END IF;
      IF r.assign_user_id IS NOT NULL AND app.is_member(c.board_id, r.assign_user_id) THEN
        INSERT INTO public.card_assignees (card_id, user_id, board_id) VALUES (c.id, r.assign_user_id, c.board_id)
        ON CONFLICT DO NOTHING;
      END IF;
      IF r.set_priority IS NOT NULL THEN
        UPDATE public.cards SET priority = r.set_priority WHERE id = c.id AND priority IS DISTINCT FROM r.set_priority;
      END IF;
      IF r.set_due_days IS NOT NULL THEN
        due := current_date + r.set_due_days;
        UPDATE public.cards SET due_date = due, start_date = least(start_date, due)
        WHERE id = c.id AND due_date IS DISTINCT FROM due;
      END IF;
      IF r.archive THEN
        UPDATE public.cards SET archived_at = now() WHERE id = c.id AND archived_at IS NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'board rule % failed: %', r.id, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('app.rules_running', '', true);
  PERFORM set_config('app.user_id', prev_user, true);
  PERFORM set_config('app.automation', prev_automation, true);
  PERFORM set_config('app.client_id', prev_client, true);
  RETURN NULL;
END
$$;
