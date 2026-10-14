-- Personal access tokens and board webhooks.

-- ---------------------------------------------------------------- api tokens

-- Users list, create and revoke their own tokens (never un-revoke). token_hash
-- can be written but not read back: kanban_app never sees anyone's hash.
-- (INSERT is table-wide: drizzle names every column, DEFAULT included.)
GRANT SELECT (id, user_id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at) ON api_tokens TO kanban_app;
--> statement-breakpoint
GRANT INSERT ON api_tokens TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON api_tokens TO kanban_app;
--> statement-breakpoint
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_tokens_select ON api_tokens FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY api_tokens_insert ON api_tokens FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND revoked_at IS NULL AND last_used_at IS NULL);
--> statement-breakpoint
CREATE POLICY api_tokens_revoke ON api_tokens FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id() AND revoked_at IS NULL)
  WITH CHECK (user_id = app.current_user_id() AND revoked_at IS NOT NULL);
--> statement-breakpoint

-- Bearer authentication (kanban_auth, before anyone is known): the live token
-- with this sha256, if any, and its owner. Revoked, expired and orphaned
-- tokens resolve to nothing. last_used_at moves at most every 5 minutes.
CREATE FUNCTION app.resolve_api_token(hash text)
RETURNS TABLE (token_id uuid, user_id uuid, scopes text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  t public.api_tokens;
BEGIN
  SELECT k.* INTO t FROM public.api_tokens k
  JOIN public.users u ON u.id = k.user_id
  WHERE k.token_hash = hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now());
  IF NOT FOUND THEN RETURN; END IF;
  IF t.last_used_at IS NULL OR t.last_used_at < now() - interval '5 minutes' THEN
    UPDATE public.api_tokens SET last_used_at = now() WHERE id = t.id;
  END IF;
  RETURN QUERY SELECT t.id, t.user_id, t.scopes;
END
$$;
--> statement-breakpoint

-- Tokens do not follow session_version (a password change or new sign-in
-- leaves them working); a password reset, the account recovery path, revokes
-- them all (POST /api/auth/reset-password, kanban_auth).
CREATE FUNCTION app.revoke_api_tokens(u uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ UPDATE public.api_tokens SET revoked_at = now() WHERE user_id = u AND revoked_at IS NULL $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- webhooks

-- Board owners (effective role) manage webhooks; nobody else sees them. The
-- secret is write-only for kanban_app (shown once at creation; the test ping
-- reads it through app.webhook_ping_target). Delivery state is written by
-- app.record_webhook_result. No notify trigger: webhooks are not part of the
-- board view, and every delivery updates the row.
GRANT SELECT (id, board_id, url, format, events, active, created_by, created_at, last_status, last_error, last_delivery_at, failure_count)
  ON board_webhooks TO kanban_app;
--> statement-breakpoint
GRANT INSERT ON board_webhooks TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (url, format, events, active) ON board_webhooks TO kanban_app;
--> statement-breakpoint
GRANT DELETE ON board_webhooks TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_webhooks_select ON board_webhooks FOR SELECT TO kanban_app
  USING (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY board_webhooks_insert ON board_webhooks FOR INSERT TO kanban_app
  WITH CHECK (app.board_role(board_id) = 'owner' AND created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY board_webhooks_update ON board_webhooks FOR UPDATE TO kanban_app
  USING (app.board_role(board_id) = 'owner')
  WITH CHECK (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY board_webhooks_delete ON board_webhooks FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner');
--> statement-breakpoint

-- New webhooks start with no delivery history (INSERT is table-wide, see
-- api_tokens). Turning one back on, or pointing it elsewhere, starts the
-- failure count afresh.
CREATE FUNCTION app.reset_webhook_failures() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_status := NULL;
    NEW.last_error := NULL;
    NEW.last_delivery_at := NULL;
    NEW.failure_count := 0;
    NEW.created_at := now();
  ELSIF (NEW.active AND NOT OLD.active) OR NEW.url IS DISTINCT FROM OLD.url THEN
    NEW.failure_count := 0;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER board_webhooks_reset_failures BEFORE INSERT OR UPDATE OF active, url ON board_webhooks
FOR EACH ROW EXECUTE FUNCTION app.reset_webhook_failures();
--> statement-breakpoint

-- The outbox has no grants and no policies: only the functions below touch it.
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Queues a delivery per matching active webhook (empty events = all kinds) and
-- wakes the senders (NOTIFY board_webhooks, sent at commit). Like
-- notifications, boards created in the same transaction (copies, imports) and
-- archived boards send nothing; templates log no activity at all.
CREATE FUNCTION app.enqueue_webhooks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.webhook_deliveries (webhook_id, activity_id)
  SELECT w.id, NEW.id FROM public.board_webhooks w
  WHERE w.board_id = NEW.board_id AND w.active AND (cardinality(w.events) = 0 OR NEW.kind = ANY (w.events));
  IF FOUND THEN
    PERFORM pg_notify('board_webhooks', json_build_object('a', NEW.id)::text);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_activity_webhooks AFTER INSERT ON card_activity
FOR EACH ROW EXECUTE FUNCTION app.enqueue_webhooks();
--> statement-breakpoint

-- Claims up to max_rows due deliveries (kanban_auth; on NOTIFY and every
-- minute, from any number of instances): SKIP LOCKED, then a 2 minute lease so
-- a sender that dies mid-request is retried. Returns what the payload needs.
-- Also drops finished rows after 7 days and queued rows of webhooks that were
-- turned off.
CREATE FUNCTION app.claim_webhook_deliveries(max_rows integer DEFAULT 20)
RETURNS TABLE (delivery_id uuid, webhook_id uuid, url text, format public.webhook_format, secret text, attempt integer,
  activity_id uuid, kind text, data jsonb, created_at timestamptz,
  card_id uuid, card_title text, board_id uuid, board_name text, actor_id uuid, actor_name text)
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
    a.id, a.kind, a.data, a.created_at, a.card_id, k.title, b.id, b.name, a.actor_id, u.name
  FROM claimed c
  JOIN public.board_webhooks w ON w.id = c.webhook_id
  JOIN public.card_activity a ON a.id = c.activity_id
  JOIN public.cards k ON k.id = a.card_id
  JOIN public.boards b ON b.id = a.board_id
  LEFT JOIN public.users u ON u.id = a.actor_id;
END
$$;
--> statement-breakpoint

-- Last result on the webhook. counted: a real delivery attempt (not a test
-- ping) that moves failure_count, which turns the webhook off at 20 in a row.
CREATE FUNCTION app.record_webhook_result(w uuid, ok boolean, http_status integer, err text, counted boolean)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  UPDATE public.board_webhooks SET
    last_status = http_status,
    last_error = CASE WHEN ok THEN NULL ELSE left(err, 500) END,
    last_delivery_at = now(),
    failure_count = CASE WHEN NOT counted THEN failure_count WHEN ok THEN 0 ELSE failure_count + 1 END,
    active = active AND NOT (counted AND NOT ok AND failure_count + 1 >= 20)
  WHERE id = w
$$;
--> statement-breakpoint

-- Outcome of a claimed delivery: delivered, or retried after 1 min, 5 min,
-- 30 min, 2 h, and failed after the 5th attempt.
CREATE FUNCTION app.finish_webhook_delivery(d uuid, ok boolean, http_status integer, err text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  w uuid;
BEGIN
  UPDATE public.webhook_deliveries SET
    status = CASE WHEN ok THEN 'delivered' WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
    next_attempt_at = now() + CASE attempts
      WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' WHEN 3 THEN interval '30 minutes' ELSE interval '2 hours' END
  WHERE id = d AND status = 'pending'
  RETURNING webhook_id INTO w;
  IF FOUND THEN
    PERFORM app.record_webhook_result(w, ok, http_status, err, true);
  END IF;
END
$$;
--> statement-breakpoint

-- The test ping (POST /api/webhooks/:id/test) needs the secret: owners only,
-- otherwise no row.
CREATE FUNCTION app.webhook_ping_target(w uuid)
RETURNS TABLE (url text, format public.webhook_format, secret text, board_id uuid, board_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT h.url, h.format, h.secret, b.id, b.name
  FROM public.board_webhooks h JOIN public.boards b ON b.id = h.board_id
  WHERE h.id = w AND app.board_role(h.board_id) = 'owner'
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.resolve_api_token(text), app.revoke_api_tokens(uuid), app.reset_webhook_failures(),
  app.enqueue_webhooks(), app.claim_webhook_deliveries(integer), app.record_webhook_result(uuid, boolean, integer, text, boolean),
  app.finish_webhook_delivery(uuid, boolean, integer, text), app.webhook_ping_target(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_api_token(text), app.revoke_api_tokens(uuid), app.claim_webhook_deliveries(integer),
  app.record_webhook_result(uuid, boolean, integer, text, boolean), app.finish_webhook_delivery(uuid, boolean, integer, text) TO kanban_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.webhook_ping_target(uuid) TO kanban_app;
