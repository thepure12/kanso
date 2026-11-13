-- Web Push (server/utils/push.ts). A browser that turns push on stores its
-- subscription through app.save_push_subscription, tied to the sign-in session
-- that made it. Users list and delete their own rows; kanban_app never reads
-- the encryption keys. Revoking a session deletes its subscriptions, and a
-- notifications trigger queues one push_messages row per notification for
-- users that have any.

GRANT SELECT (id, user_id, endpoint, user_agent, created_at, last_success_at), DELETE ON push_subscriptions TO kanban_app;
--> statement-breakpoint
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
-- Outbox: no grants, RLS on with no policies as a second lock.
ALTER TABLE push_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Saves the caller's subscription for session sid (a live session of theirs,
-- else 42501). An endpoint is one browser: when another user signed in there
-- before, the row moves to the caller. Keeps the newest 20 per user.
CREATE FUNCTION app.save_push_subscription(sid uuid, ep text, key text, secret text, ua text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  me uuid := app.current_user_id();
  sub uuid;
BEGIN
  IF me IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_sessions WHERE id = sid AND user_id = me AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_subscriptions AS p (user_id, session_id, endpoint, p256dh, auth, user_agent)
  VALUES (me, sid, ep, key, secret, left(ua, 500))
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent, failure_count = 0,
    created_at = CASE WHEN p.user_id = EXCLUDED.user_id THEN p.created_at ELSE now() END
  RETURNING id INTO sub;
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE user_id = me ORDER BY created_at DESC, id OFFSET 20
  );
  RETURN sub;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.drop_session_push_subscriptions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.push_subscriptions WHERE session_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER user_sessions_drop_push AFTER UPDATE OF revoked_at ON user_sessions
FOR EACH ROW WHEN (NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION app.drop_session_push_subscriptions();
--> statement-breakpoint

CREATE FUNCTION app.enqueue_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id) THEN
    INSERT INTO public.push_messages (notification_id) VALUES (NEW.id);
    PERFORM pg_notify('push_messages', '{}');
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER notifications_enqueue_push AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION app.enqueue_push();
--> statement-breakpoint

-- Claims up to max_rows queued messages (kanban_auth; on NOTIFY and every
-- minute, from any number of instances): SKIP LOCKED, then a 2 minute lease so
-- a sender that dies mid-run is retried, at most 3 times. Messages older than
-- a day are dropped. Returns what the payload needs and the user's
-- subscriptions; read is true when the notification was read meanwhile.
CREATE FUNCTION app.claim_push_messages(max_rows integer DEFAULT 20)
RETURNS TABLE (message_id uuid, notification_id uuid, user_id uuid, read boolean, kind text, data jsonb,
  card_id uuid, card_title text, board_id uuid, board_name text, actor_name text, locale text, subscriptions jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.push_messages m WHERE m.attempts >= 3 OR m.created_at < now() - interval '1 day';
  RETURN QUERY
  WITH due AS (
    SELECT m.id FROM public.push_messages m
    WHERE m.next_attempt_at <= now()
    ORDER BY m.next_attempt_at
    LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.push_messages m
    SET attempts = m.attempts + 1, next_attempt_at = now() + interval '2 minutes'
    FROM due WHERE m.id = due.id
    RETURNING m.id, m.notification_id
  )
  SELECT c.id, n.id, n.user_id, n.read_at IS NOT NULL, a.kind::text, a.data,
    k.id, k.title, b.id, b.name, u.name, r.locale,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
      FROM public.push_subscriptions s WHERE s.user_id = n.user_id), '[]'::jsonb)
  FROM claimed c
  JOIN public.notifications n ON n.id = c.notification_id
  JOIN public.users r ON r.id = n.user_id
  JOIN public.card_activity a ON a.id = n.activity_id
  JOIN public.cards k ON k.id = n.card_id
  JOIN public.boards b ON b.id = n.board_id
  LEFT JOIN public.users u ON u.id = a.actor_id;
END
$$;
--> statement-breakpoint

-- A claimed message is done (sent to every subscription, successfully or not).
CREATE FUNCTION app.finish_push_message(m uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  DELETE FROM public.push_messages WHERE id = m
$$;
--> statement-breakpoint

-- Result of one send. gone: the push service no longer knows the endpoint
-- (404/410, the browser unsubscribed) or refused our key (403); the row is
-- deleted. 20 other failures in a row delete it too.
CREATE FUNCTION app.record_push_result(sub uuid, ok boolean, gone boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF ok THEN
    UPDATE public.push_subscriptions SET last_success_at = now(), failure_count = 0 WHERE id = sub;
  ELSIF gone THEN
    DELETE FROM public.push_subscriptions WHERE id = sub;
  ELSE
    UPDATE public.push_subscriptions SET failure_count = failure_count + 1 WHERE id = sub;
    DELETE FROM public.push_subscriptions WHERE id = sub AND failure_count >= 20;
  END IF;
END
$$;
--> statement-breakpoint

-- The caller's subscriptions with their keys, for "Send a test" (one endpoint,
-- or all of them when ep is null).
CREATE FUNCTION app.my_push_targets(ep text)
RETURNS TABLE (id uuid, endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.endpoint, s.p256dh, s.auth FROM public.push_subscriptions s
  WHERE s.user_id = app.current_user_id() AND (ep IS NULL OR s.endpoint = ep)
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.save_push_subscription(uuid, text, text, text, text), app.drop_session_push_subscriptions(),
  app.enqueue_push(), app.claim_push_messages(integer), app.finish_push_message(uuid),
  app.record_push_result(uuid, boolean, boolean), app.my_push_targets(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.save_push_subscription(uuid, text, text, text, text), app.my_push_targets(text) TO kanban_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_push_messages(integer), app.finish_push_message(uuid),
  app.record_push_result(uuid, boolean, boolean) TO kanban_auth;
