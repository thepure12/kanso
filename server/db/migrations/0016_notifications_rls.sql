-- Personal notifications. Each card_activity row fans out to the card's
-- assignees (except the actor) for the kinds below; the row is the recipient's
-- inbox entry and points back at the activity for the text. Recipients get
-- NOTIFY user_notifications {"u": user id} and refetch through RLS.

-- assigned activity now records which user was assigned, so only that user is
-- notified. The name stays for the activity log text.
CREATE OR REPLACE FUNCTION app.log_card_assignee_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.card_assignees := CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
BEGIN
  PERFORM app.log_activity(r.card_id, r.board_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'assigned' ELSE 'unassigned' END,
    jsonb_build_object('user', (SELECT name FROM public.users WHERE id = r.user_id), 'user_id', r.user_id));
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- Recipients must still have access to the board (assignments outlive access).
-- Activity on a board created in the same transaction (a copy) notifies nobody.
CREATE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'moved', 'due', 'archived')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND created_at = now()) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT ca.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM public.card_assignees ca
  WHERE ca.card_id = NEW.card_id
    AND ca.user_id IS DISTINCT FROM NEW.actor_id
    AND (NEW.kind <> 'assigned' OR ca.user_id = (NEW.data ->> 'user_id')::uuid)
    AND app.is_member(NEW.board_id, ca.user_id);
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.fan_out_notification() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER card_activity_fan_out
AFTER INSERT ON card_activity
FOR EACH ROW EXECUTE FUNCTION app.fan_out_notification();
--> statement-breakpoint

-- Written by the trigger only. Users read, mark read and delete their own, and
-- stop seeing a board's notifications once they lose access to it.
GRANT SELECT, UPDATE (read_at), DELETE ON notifications TO kanban_app;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_select ON notifications FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY notifications_update ON notifications FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY notifications_delete ON notifications FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
