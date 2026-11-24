-- mark_completed column rules (0141): a card created in the column or moved
-- into it is marked complete (completed_at), keeping the time of an earlier
-- completion. The card stays complete when it leaves the column again. Set by
-- the BEFORE trigger like set_due, so the AFTER triggers on cards log
-- `completed` and queue the board rule event `card_completed` for moves. No
-- policy changes: column rules keep their policies. kind is compared as text
-- because 0141 adds the enum value in the same transaction.

-- As in 0029, plus mark_completed.
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
    IF NEW.completed_at IS NULL AND EXISTS (
      SELECT 1 FROM public.column_rules r
      WHERE r.column_id = NEW.column_id AND r.kind::text = 'mark_completed'
    ) THEN
      NEW.completed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- As in 0135, plus card_completed for cards created complete (a mark_completed
-- rule on the column they are created in).
CREATE OR REPLACE FUNCTION app.cards_queue_rule_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'card_created');
    IF NEW.due_date IS NOT NULL THEN
      PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'due_set');
    END IF;
    IF NEW.completed_at IS NOT NULL THEN
      PERFORM app.queue_rule_event(NEW.id, NEW.board_id, 'card_completed');
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

-- As in 0135, plus `completed` after `created` for cards created complete.
CREATE OR REPLACE FUNCTION app.log_card_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.log_activity(NEW.id, NEW.board_id, 'created',
      jsonb_build_object('column', (SELECT title FROM public.columns WHERE id = NEW.column_id)));
    IF NEW.completed_at IS NOT NULL THEN
      PERFORM app.log_activity(NEW.id, NEW.board_id, 'completed');
    END IF;
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
