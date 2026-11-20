-- Checklist item assignees and due dates (0097: checklist_items.assignee_id,
-- due_date). Editors of the card set them through the existing update policy;
-- the assignee must be on the board and able to see the card (else 42501).
-- Assigning someone logs `checklist_assigned` {user, user_id, item}, which
-- notifies only that person (as event `assigned`, a direct notification).
-- Due soon (GET /api/notifications) and the digest also list open items
-- assigned to the user that are due by tomorrow.

GRANT UPDATE (assignee_id, due_date) ON checklist_items TO kanban_app;
--> statement-breakpoint

CREATE FUNCTION app.check_checklist_assignee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
     AND (NOT app.is_member(NEW.board_id, NEW.assignee_id)
          OR app.user_card_access(NEW.assignee_id, NEW.card_id) = 'none') THEN
    RAISE EXCEPTION 'checklist assignee must be able to see the card' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_check_assignee
BEFORE INSERT OR UPDATE OF assignee_id ON checklist_items
FOR EACH ROW EXECUTE FUNCTION app.check_checklist_assignee();
--> statement-breakpoint

-- On updates only when the assignee changes (WHEN cannot read OLD on INSERT).
CREATE FUNCTION app.log_checklist_assignee_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
    RETURN NULL;
  END IF;
  PERFORM app.log_activity(NEW.card_id, NEW.board_id, 'checklist_assigned', jsonb_build_object(
    'user', (SELECT name FROM public.users WHERE id = NEW.assignee_id),
    'user_id', NEW.assignee_id,
    'item', NEW.text));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER checklist_items_log_assignee
AFTER INSERT OR UPDATE OF assignee_id ON checklist_items
FOR EACH ROW
WHEN (NEW.assignee_id IS NOT NULL)
EXECUTE FUNCTION app.log_checklist_assignee_activity();
--> statement-breakpoint
-- ---------------------------------------------------------------- notifications

-- As in 0094, plus checklist_assigned (counts as `assigned`).
CREATE OR REPLACE FUNCTION app.notification_event(kind text, data jsonb, u uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN kind = 'mentioned' OR (kind = 'commented' AND coalesce(data -> 'mentions', '[]') ? u::text) THEN 'mentioned'
    WHEN kind = 'woke' THEN 'reminder'
    WHEN kind = 'checklist_assigned' THEN 'assigned'
    ELSE kind END
$$;
--> statement-breakpoint

-- As in 0094, plus checklist_assigned: sent only to the assigned person, like a personal reminder.
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
  personal uuid := CASE WHEN NEW.kind IN ('reminder', 'checklist_assigned') THEN (NEW.data ->> 'user_id')::uuid END;
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived', 'stale', 'reminder', 'woke', 'checklist_assigned')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO mentioned
  FROM jsonb_array_elements_text(coalesce(NEW.data -> 'mentions', '[]')) x;

  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT r.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM (
    SELECT p.user_id, bool_or(p.src = 'assignee') AS assignee, bool_or(p.src = 'mention') AS mention,
      bool_or(p.src = 'direct') AS direct
    FROM (
      SELECT ca.user_id, 'assignee' AS src FROM public.card_assignees ca
      WHERE ca.card_id = NEW.card_id AND NEW.kind <> 'mentioned' AND personal IS NULL
        AND (NEW.kind <> 'assigned' OR ca.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT w.user_id, 'watcher' FROM public.card_watchers w
      WHERE w.card_id = NEW.card_id AND NEW.kind <> 'mentioned' AND personal IS NULL
        AND (NEW.kind <> 'assigned' OR w.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT unnest(mentioned), 'mention'
      UNION ALL
      SELECT personal, 'direct' WHERE personal IS NOT NULL
    ) p
    GROUP BY p.user_id
  ) r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.board_notification_settings s ON s.board_id = NEW.board_id AND s.user_id = r.user_id
  WHERE r.user_id IS DISTINCT FROM NEW.actor_id
    AND app.is_member(NEW.board_id, r.user_id)
    AND app.user_card_access(r.user_id, NEW.card_id) <> 'none'
    -- Only watching: the user may have turned watched cards off.
    AND (r.assignee OR r.mention OR r.direct OR NEW.kind = 'assigned' OR u.notify_watching)
    AND (s.level IS NULL OR (s.level = 'direct' AND (r.mention OR r.direct OR NEW.kind = 'assigned')))
    AND app.notify_on(u.notification_prefs, app.notification_event(NEW.kind::text, NEW.data, r.user_id), 'inbox');
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- As in 0088, plus open checklist items assigned to the user (title "Card › item").
CREATE OR REPLACE FUNCTION app.claim_digests()
RETURNS TABLE(user_id uuid, email text, name text, locale text, items jsonb, due jsonb)
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
        AND app.user_access(k.board_id, c.id, k.column_id, k.id) <> 'none'
        AND app.notify_on(c.prefs, app.notification_event(a.kind::text, a.data, c.id), 'email')
      ORDER BY n.created_at DESC LIMIT 50
    ) s
  ) i
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'boardId', x.board_id, 'boardName', x.board_name, 'cardId', x.card_id, 'cardTitle', x.title, 'dueDate', x.due_date)
      ORDER BY x.due_date), '[]') AS due
    FROM (
      SELECT k.board_id, b.name AS board_name, k.id AS card_id, k.title, k.due_date
      FROM public.card_assignees ca
      JOIN public.cards k ON k.id = ca.card_id
      JOIN public.boards b ON b.id = k.board_id
      WHERE ca.user_id = c.id AND k.archived_at IS NULL AND k.deleted_at IS NULL AND NOT k.is_template AND b.archived_at IS NULL
        AND k.due_date <= current_date + 1
        AND app.is_member(k.board_id, c.id)
        AND app.user_access(k.board_id, c.id, k.column_id, k.id) <> 'none'
      UNION ALL
      SELECT k.board_id, b.name, k.id, k.title || ' › ' || ci.text, ci.due_date
      FROM public.checklist_items ci
      JOIN public.cards k ON k.id = ci.card_id
      JOIN public.boards b ON b.id = k.board_id
      WHERE ci.assignee_id = c.id AND NOT ci.done
        AND k.archived_at IS NULL AND k.deleted_at IS NULL AND NOT k.is_template AND b.archived_at IS NULL
        AND ci.due_date <= current_date + 1
        AND app.is_member(k.board_id, c.id)
        AND app.user_access(k.board_id, c.id, k.column_id, k.id) <> 'none'
    ) x
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
