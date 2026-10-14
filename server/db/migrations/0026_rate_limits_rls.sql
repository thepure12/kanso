-- Durable rate limiter for login, sign-up and password reset, shared by every
-- app instance and kept across restarts. Fixed window per key: the first hit
-- opens a window of `win`, hits past `max_hits` inside it are refused.

CREATE FUNCTION app.hit_rate_limit(k text, max_hits integer, win interval) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  n integer;
BEGIN
  -- Expired windows are dead weight; the reset_at index keeps this cheap.
  DELETE FROM public.rate_limits WHERE reset_at < now();

  -- Atomic: concurrent hits on one key serialize on the row.
  INSERT INTO public.rate_limits AS r (key, count, reset_at) VALUES (k, 1, now() + win)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN r.reset_at < now() THEN 1 ELSE r.count + 1 END,
    reset_at = CASE WHEN r.reset_at < now() THEN now() + win ELSE r.reset_at END
  RETURNING count INTO n;
  RETURN n <= max_hits;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.hit_rate_limit(text, integer, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.hit_rate_limit(text, integer, interval) TO kanban_auth;
--> statement-breakpoint

-- No grants and no policies: only the function above touches the table.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
