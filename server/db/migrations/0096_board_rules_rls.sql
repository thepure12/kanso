-- Event-triggered board rules (board_rules, 0095): "when <event> and
-- <conditions>, do <actions>".
--
-- Flow: immediate AFTER triggers on cards, card_tags, card_assignees,
-- checklist_items and card_comments queue an event row in board_rule_events
-- (only when the board has an active rule for it). A deferred constraint
-- trigger on that queue runs the matching rules when the transaction commits,
-- so conditions see the card as the whole request left it (a card created with
-- tags already has them). Rules run as the owner in automation mode: actor
-- null, `automation: true` in the activity, app.client_id empty so every tab
-- (the one that triggered it too) refreshes. While they run, app.rules_running
-- is 'on' and the queue triggers record nothing, so a rule's own changes never
-- trigger rules (no loops). Column rules still run on a rule's move.
-- Templates, trashed and archived cards, archived boards and boards created in
-- the same transaction (copies, imports) are skipped.

-- ---------------------------------------------------------------- policies

-- As board automations: anyone who can see the board reads its rules (limited
-- members see none: they cannot manage structure and rules may name columns
-- they cannot see), editors manage them. Users named by a rule must be board
-- members. created_by is the caller.
GRANT SELECT, INSERT, DELETE ON board_rules TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (event, event_tag_id, event_user_id, cond_tag_id, cond_priority, cond_column_id, cond_assignee_id,
  move_column_id, add_tag_id, remove_tag_id, assign_user_id, set_priority, set_due_days, archive, active) ON board_rules TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE board_rule_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_rules_select ON board_rules FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL AND board_id NOT IN (SELECT app.limited_board_ids()));
--> statement-breakpoint
CREATE FUNCTION app.board_rule_users_ok(r public.board_rules) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT (r.event_user_id IS NULL OR app.is_member(r.board_id, r.event_user_id))
     AND (r.cond_assignee_id IS NULL OR app.is_member(r.board_id, r.cond_assignee_id))
     AND (r.assign_user_id IS NULL OR app.is_member(r.board_id, r.assign_user_id))
$$;
--> statement-breakpoint
CREATE POLICY board_rules_insert ON board_rules FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id() AND app.board_rule_users_ok(board_rules));
--> statement-breakpoint
CREATE POLICY board_rules_update ON board_rules FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id) AND app.board_rule_users_ok(board_rules));
--> statement-breakpoint
CREATE POLICY board_rules_delete ON board_rules FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER board_rules_notify AFTER INSERT OR UPDATE OR DELETE ON board_rules
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint

-- ---------------------------------------------------------------- queue

-- Records an event for the card when its board has an active rule for it.
-- Nothing while rules run (their changes do not trigger rules).
CREATE FUNCTION app.queue_rule_event(card uuid, board uuid, ev public.board_rule_event, tag uuid DEFAULT NULL, usr uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.rules_running', true) = 'on' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.board_rules r
             WHERE r.board_id = board AND r.active AND r.event = ev
               AND (r.event_tag_id IS NULL OR r.event_tag_id = tag)
               AND (r.event_user_id IS NULL OR r.event_user_id = usr)) THEN
    INSERT INTO public.board_rule_events (card_id, board_id, event, tag_id, user_id)
    VALUES (card, board, ev, tag, usr);
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.queue_rule_event(uuid, uuid, public.board_rule_event, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION app.cards_queue_rule_events() RETURNS trigger
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
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cards_queue_rule_events AFTER INSERT OR UPDATE OF column_id, due_date ON cards
FOR EACH ROW WHEN (NOT NEW.is_template) EXECUTE FUNCTION app.cards_queue_rule_events();
--> statement-breakpoint

CREATE FUNCTION app.card_tags_queue_rule_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.queue_rule_event(NEW.card_id, NEW.board_id, 'tag_added', NEW.tag_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_tags_queue_rule_event AFTER INSERT ON card_tags
FOR EACH ROW EXECUTE FUNCTION app.card_tags_queue_rule_event();
--> statement-breakpoint

CREATE FUNCTION app.card_assignees_queue_rule_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.queue_rule_event(NEW.card_id, NEW.board_id, 'assigned', NULL, NEW.user_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_assignees_queue_rule_event AFTER INSERT ON card_assignees
FOR EACH ROW EXECUTE FUNCTION app.card_assignees_queue_rule_event();
--> statement-breakpoint

-- Ticking an item queues the event; the run checks that every item is done.
CREATE FUNCTION app.checklist_items_queue_rule_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.checklist_items WHERE card_id = NEW.card_id AND NOT done) THEN
    PERFORM app.queue_rule_event(NEW.card_id, NEW.board_id, 'checklist_completed');
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_queue_rule_event AFTER UPDATE OF done ON checklist_items
FOR EACH ROW WHEN (NEW.done AND NOT OLD.done) EXECUTE FUNCTION app.checklist_items_queue_rule_event();
--> statement-breakpoint

CREATE FUNCTION app.card_comments_queue_rule_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.queue_rule_event(NEW.card_id, NEW.board_id, 'commented');
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_comments_queue_rule_event AFTER INSERT ON card_comments
FOR EACH ROW WHEN (NEW.imported_author IS NULL) EXECUTE FUNCTION app.card_comments_queue_rule_event();
--> statement-breakpoint

-- ---------------------------------------------------------------- runner

-- Runs the rules matching one queued event (deferred: at commit) and deletes
-- the event. Each rule re-reads the card (an earlier rule may have changed
-- it), checks its conditions, then applies its actions in a fixed order: move,
-- tags, assignee, priority, due date, archive. A failing rule is skipped with a
-- warning, never failing the request that triggered it.
CREATE FUNCTION app.run_board_rule_event() RETURNS trigger
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
       OR EXISTS (SELECT 1 FROM public.checklist_items WHERE card_id = e.card_id AND NOT done))) THEN
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
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER board_rule_events_run AFTER INSERT ON board_rule_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.run_board_rule_event();
