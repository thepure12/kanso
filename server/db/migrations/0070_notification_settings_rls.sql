-- Notification settings (shared/notificationSettings.ts):
--   users.notification_prefs  channels per event, {"<event>": {"inbox"|"push"|"email": bool}}, missing = on
--   users.notify_watching     false: watched (not assigned, not mentioned) cards send nothing
--   board_notification_settings.level  per user and board: direct (mentions and being assigned) | none; no row = all
-- Enforced where notifications are made (fan_out_notification: inbox, watching,
-- board level), queued for push (enqueue_push) and mailed (claim_digests).

-- kanban_app may change its own prefs (users_update: own row) but not read
-- them: users rows of other people are visible, so a SELECT grant would show
-- their settings. GET /api/account reads them as kanban_auth.
GRANT UPDATE (notification_prefs, notify_watching) ON users TO kanban_app;
--> statement-breakpoint

CREATE FUNCTION app.notification_prefs_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(p) e
    WHERE e.key NOT IN ('assigned', 'mentioned', 'commented', 'moved', 'due', 'archived', 'stale')
       OR jsonb_typeof(e.value) <> 'object'
       OR EXISTS (
         SELECT 1 FROM jsonb_each(e.value) c
         WHERE c.key NOT IN ('inbox', 'push', 'email') OR jsonb_typeof(c.value) <> 'boolean'
       )
  )
$$;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_notification_prefs_shape CHECK (app.notification_prefs_valid(notification_prefs));
--> statement-breakpoint

-- The event a notification counts as for user u (notificationEvent in
-- shared/notificationSettings.ts): a comment mentioning u is a mention.
CREATE FUNCTION app.notification_event(kind text, data jsonb, u uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN kind = 'mentioned' OR (kind = 'commented' AND coalesce(data -> 'mentions', '[]') ? u::text)
    THEN 'mentioned' ELSE kind END
$$;
--> statement-breakpoint

-- Whether a channel is on for an event (channelOn): missing = on; push and
-- email need the inbox.
CREATE FUNCTION app.notify_on(prefs jsonb, event text, channel text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT coalesce((prefs -> event ->> channel)::boolean, true)
    AND (channel = 'inbox' OR coalesce((prefs -> event ->> 'inbox')::boolean, true))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.notification_event(text, jsonb, uuid), app.notify_on(jsonb, text, text) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------- board level

GRANT SELECT, INSERT, DELETE, UPDATE (level) ON board_notification_settings TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_notification_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_notification_settings_select ON board_notification_settings FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_notification_settings_insert ON board_notification_settings FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_notification_settings_update ON board_notification_settings FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL)
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY board_notification_settings_delete ON board_notification_settings FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------- fan-out

CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived', 'stale')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO mentioned
  FROM jsonb_array_elements_text(coalesce(NEW.data -> 'mentions', '[]')) x;

  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT r.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM (
    SELECT p.user_id, bool_or(p.src = 'assignee') AS assignee, bool_or(p.src = 'mention') AS mention
    FROM (
      SELECT ca.user_id, 'assignee' AS src FROM public.card_assignees ca
      WHERE ca.card_id = NEW.card_id AND NEW.kind <> 'mentioned'
        AND (NEW.kind <> 'assigned' OR ca.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT w.user_id, 'watcher' FROM public.card_watchers w
      WHERE w.card_id = NEW.card_id AND NEW.kind <> 'mentioned'
        AND (NEW.kind <> 'assigned' OR w.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT unnest(mentioned), 'mention'
    ) p
    GROUP BY p.user_id
  ) r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.board_notification_settings s ON s.board_id = NEW.board_id AND s.user_id = r.user_id
  WHERE r.user_id IS DISTINCT FROM NEW.actor_id
    AND app.is_member(NEW.board_id, r.user_id)
    -- Only watching: the user may have turned watched cards off.
    AND (r.assignee OR r.mention OR NEW.kind = 'assigned' OR u.notify_watching)
    AND (s.level IS NULL OR (s.level = 'direct' AND (r.mention OR NEW.kind = 'assigned')))
    AND app.notify_on(u.notification_prefs, app.notification_event(NEW.kind::text, NEW.data, r.user_id), 'inbox');
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- push

CREATE OR REPLACE FUNCTION app.enqueue_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id)
     AND EXISTS (
       SELECT 1 FROM public.users u, public.card_activity a
       WHERE u.id = NEW.user_id AND a.id = NEW.activity_id
         AND app.notify_on(u.notification_prefs, app.notification_event(a.kind::text, a.data, u.id), 'push')
     ) THEN
    INSERT INTO public.push_messages (notification_id) VALUES (NEW.id);
    PERFORM pg_notify('push_messages', '{}');
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- digest

-- As in 0058, plus: items only for events with the email channel on.
CREATE OR REPLACE FUNCTION app.claim_digests()
RETURNS TABLE (user_id uuid, email text, name text, locale text, items jsonb, due jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH pending AS (
    SELECT u.id, u.digest_sent_at AS prev FROM public.users u
    WHERE u.digest_enabled AND u.email_verified_at IS NOT NULL
      AND (u.digest_sent_at IS NULL OR u.digest_sent_at < date_trunc('day', now()))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.users u SET digest_sent_at = now()
    FROM pending p WHERE u.id = p.id
    RETURNING u.id, u.email::text AS email, u.name, u.locale, u.notification_prefs AS prefs, p.prev
  )
  SELECT c.id, c.email, c.name, c.locale, i.items, d.due
  FROM claimed c
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'createdAt' DESC), '[]') AS items FROM (
      SELECT jsonb_build_object(
        'boardId', n.board_id, 'boardName', b.name, 'cardId', n.card_id, 'cardTitle', k.title,
        'actorName', au.name, 'kind', a.kind, 'data', a.data, 'createdAt', a.created_at) AS x
      FROM public.notifications n
      JOIN public.card_activity a ON a.id = n.activity_id
      JOIN public.cards k ON k.id = n.card_id AND k.deleted_at IS NULL
      JOIN public.boards b ON b.id = n.board_id
      LEFT JOIN public.users au ON au.id = a.actor_id
      WHERE n.user_id = c.id AND n.read_at IS NULL
        AND n.created_at > coalesce(c.prev, '-infinity')
        AND b.archived_at IS NULL
        AND app.is_member(n.board_id, c.id)
        AND app.notify_on(c.prefs, app.notification_event(a.kind::text, a.data, c.id), 'email')
      ORDER BY n.created_at DESC LIMIT 50
    ) s
  ) i
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'boardId', k.board_id, 'boardName', b.name, 'cardId', k.id, 'cardTitle', k.title, 'dueDate', k.due_date)
      ORDER BY k.due_date), '[]') AS due
    FROM public.card_assignees ca
    JOIN public.cards k ON k.id = ca.card_id
    JOIN public.boards b ON b.id = k.board_id
    WHERE ca.user_id = c.id AND k.archived_at IS NULL AND k.deleted_at IS NULL AND NOT k.is_template AND b.archived_at IS NULL
      AND k.due_date <= current_date + 1
      AND app.is_member(k.board_id, c.id)
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
