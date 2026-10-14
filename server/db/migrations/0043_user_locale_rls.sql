-- users.locale: the UI language (null = follow the browser). Self-service
-- like the digest toggle. Mails and webhook messages use it: the digest gets
-- it from claim_digests, webhooks use their creator's locale.
GRANT SELECT (locale), UPDATE (locale) ON users TO kanban_app;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IN ('en', 'de'));
--> statement-breakpoint

-- As in 0037, plus the recipient's locale (new column, so drop and create).
DROP FUNCTION app.claim_digests();
--> statement-breakpoint
CREATE FUNCTION app.claim_digests()
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
    RETURNING u.id, u.email::text AS email, u.name, u.locale, p.prev
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
      JOIN public.cards k ON k.id = n.card_id
      JOIN public.boards b ON b.id = n.board_id
      LEFT JOIN public.users au ON au.id = a.actor_id
      WHERE n.user_id = c.id AND n.read_at IS NULL
        AND n.created_at > coalesce(c.prev, '-infinity')
        AND b.archived_at IS NULL
        AND app.is_member(n.board_id, c.id)
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
    WHERE ca.user_id = c.id AND k.archived_at IS NULL AND NOT k.is_template AND b.archived_at IS NULL
      AND k.due_date <= current_date + 1
      AND app.is_member(k.board_id, c.id)
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.claim_digests() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_digests() TO kanban_auth;
--> statement-breakpoint

-- As in 0041, plus the webhook creator's locale for slack/discord text.
DROP FUNCTION app.claim_webhook_deliveries(integer);
--> statement-breakpoint
CREATE FUNCTION app.claim_webhook_deliveries(max_rows integer DEFAULT 20)
RETURNS TABLE (delivery_id uuid, webhook_id uuid, url text, format public.webhook_format, secret text, attempt integer,
  activity_id uuid, kind text, data jsonb, created_at timestamptz,
  card_id uuid, card_title text, board_id uuid, board_name text, actor_id uuid, actor_name text, locale text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.webhook_deliveries d
  WHERE (d.status <> 'pending' AND d.created_at < now() - interval '7 days')
     OR (d.status = 'pending' AND NOT EXISTS (SELECT 1 FROM public.board_webhooks w WHERE w.id = d.webhook_id AND w.active));
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.webhook_deliveries d
    WHERE d.status = 'pending' AND d.next_attempt_at <= now()
    ORDER BY d.next_attempt_at
    LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.webhook_deliveries d
    SET attempts = d.attempts + 1, next_attempt_at = now() + interval '2 minutes'
    FROM due WHERE d.id = due.id
    RETURNING d.id, d.webhook_id, d.activity_id, d.attempts
  )
  SELECT c.id, w.id, w.url, w.format, w.secret, c.attempts,
    a.id, a.kind, a.data, a.created_at, a.card_id, k.title, b.id, b.name, a.actor_id, u.name, cu.locale
  FROM claimed c
  JOIN public.board_webhooks w ON w.id = c.webhook_id
  JOIN public.card_activity a ON a.id = c.activity_id
  JOIN public.cards k ON k.id = a.card_id
  JOIN public.boards b ON b.id = a.board_id
  LEFT JOIN public.users u ON u.id = a.actor_id
  LEFT JOIN public.users cu ON cu.id = w.created_by;
END
$$;
--> statement-breakpoint
DROP FUNCTION app.webhook_ping_target(uuid);
--> statement-breakpoint
CREATE FUNCTION app.webhook_ping_target(w uuid)
RETURNS TABLE (url text, format public.webhook_format, secret text, board_id uuid, board_name text, locale text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT h.url, h.format, h.secret, b.id, b.name, u.locale
  FROM public.board_webhooks h JOIN public.boards b ON b.id = h.board_id
  LEFT JOIN public.users u ON u.id = h.created_by
  WHERE h.id = w AND app.board_role(h.board_id) = 'owner'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.claim_webhook_deliveries(integer), app.webhook_ping_target(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_webhook_deliveries(integer) TO kanban_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.webhook_ping_target(uuid) TO kanban_app;
