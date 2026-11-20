-- Board bots get notifications in their inbox only, so an agent can poll
-- GET /api/notifications (MCP list_notifications) with its token and react
-- to mentions and assignments. fan_out_notification already treats them as
-- members; this keeps them from watching every card they touch and from
-- push. The digest needs a verified email and mail goes to real addresses,
-- both of which bots never have (0102).

-- As in 0031, but bots never start watching a card by creating it or
-- commenting on it (they still watch explicitly through PUT .../watch).
CREATE OR REPLACE FUNCTION app.auto_watch_card() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  card uuid;
  watcher uuid;
BEGIN
  IF TG_TABLE_NAME = 'cards' THEN
    card := NEW.id;
    watcher := NEW.created_by;
  ELSE
    card := NEW.card_id;
    watcher := NEW.author_id;
  END IF;
  IF watcher IS NULL
     OR EXISTS (SELECT 1 FROM public.users WHERE id = watcher AND is_bot)
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND created_at = now()) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.card_watchers (card_id, board_id, user_id)
  VALUES (card, NEW.board_id, watcher)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- As in 0070, but never for bots (they have no sessions, so no
-- subscriptions either; this keeps it so whatever the path).
CREATE OR REPLACE FUNCTION app.enqueue_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id)
     AND EXISTS (
       SELECT 1 FROM public.users u, public.card_activity a
       WHERE u.id = NEW.user_id AND NOT u.is_bot AND a.id = NEW.activity_id
         AND app.notify_on(u.notification_prefs, app.notification_event(a.kind::text, a.data, u.id), 'push')
     ) THEN
    INSERT INTO public.push_messages (notification_id) VALUES (NEW.id);
    PERFORM pg_notify('push_messages', '{}');
  END IF;
  RETURN NULL;
END
$$;
