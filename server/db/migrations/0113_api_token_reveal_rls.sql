-- Showing an API token again (0112): api_tokens.token_enc holds the token
-- sealed by the app (secretBox, HKDF info `kanban/api-token/v1`). kanban_app
-- may write it on insert but never read it; it sees `viewable` instead.
-- app.reveal_api_token hands the sealed token to its owner, or to whoever
-- manages the bot it belongs to; the route asks for a TOTP code first.

GRANT SELECT (viewable, last_viewed_at) ON api_tokens TO kanban_app;
--> statement-breakpoint

DROP POLICY api_tokens_insert ON api_tokens;
--> statement-breakpoint
CREATE POLICY api_tokens_insert ON api_tokens FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND revoked_at IS NULL AND last_used_at IS NULL AND last_viewed_at IS NULL
    AND team_id IS NULL
    AND (board_ids IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(board_ids) b WHERE app.board_role(b) IS NULL)));
--> statement-breakpoint

-- A revoked token is never shown again: drop its sealed copy.
CREATE FUNCTION app.clear_revoked_token_enc() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.token_enc := NULL;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER api_tokens_clear_revoked BEFORE UPDATE OF revoked_at ON api_tokens
  FOR EACH ROW EXECUTE FUNCTION app.clear_revoked_token_enc();
--> statement-breakpoint

-- As in 0106 (managed_bot_scope from 0109), plus the sealed token. The
-- six-argument form stays (a token that cannot be shown again) for app
-- instances still running the previous version during a deploy.
CREATE FUNCTION app.create_bot_token(bot uuid, token_name text, token_scopes text[],
  token_expires_at timestamptz, token_hash text, token_prefix text, sealed text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  s record;
  tid uuid;
BEGIN
  SELECT * INTO s FROM app.managed_bot_scope(bot);
  IF token_name IS NULL OR length(btrim(token_name)) NOT BETWEEN 1 AND 100
     OR token_scopes IS NULL OR cardinality(token_scopes) = 0
     OR NOT token_scopes <@ ARRAY['read', 'write']
     OR (token_expires_at IS NOT NULL AND token_expires_at <= now())
     OR token_hash IS NULL OR token_prefix IS NULL THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.api_tokens (user_id, name, token_hash, prefix, scopes, board_ids, team_id, expires_at, token_enc)
  VALUES (bot, btrim(token_name), token_hash, token_prefix,
          ARRAY(SELECT DISTINCT unnest(token_scopes) ORDER BY 1),
          CASE WHEN s.board IS NULL THEN NULL ELSE ARRAY[s.board] END, s.team, token_expires_at, sealed)
  RETURNING id INTO tid;
  RETURN tid;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.create_bot_token(bot uuid, token_name text, token_scopes text[],
  token_expires_at timestamptz, token_hash text, token_prefix text) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT app.create_bot_token(bot, token_name, token_scopes, token_expires_at, token_hash, token_prefix, NULL::text) $$;
--> statement-breakpoint

-- As in 0106, plus viewable and last_viewed_at.
DROP FUNCTION app.bot_tokens(uuid);
--> statement-breakpoint
CREATE FUNCTION app.bot_tokens(bot uuid)
RETURNS TABLE (id uuid, name text, prefix text, scopes text[], created_at timestamptz,
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  viewable boolean, last_viewed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.managed_bot_scope(bot);
  RETURN QUERY
  SELECT k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.expires_at, k.revoked_at,
         k.viewable, k.last_viewed_at
  FROM public.api_tokens k WHERE k.user_id = bot
  ORDER BY k.created_at DESC, k.id;
END
$$;
--> statement-breakpoint

-- The sealed token of `token`, which must belong to `owner`: the caller
-- themselves, or a bot the caller manages (app.managed_bot_scope, else
-- 42501). Live tokens only (revoked, expired or someone else's: P0002).
-- Null when the token was made before 0112. Stamps last_viewed_at.
CREATE FUNCTION app.reveal_api_token(token uuid, owner uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  me uuid := app.current_user_id();
  k record;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT t.user_id, t.token_enc, u.is_bot INTO k
  FROM public.api_tokens t JOIN public.users u ON u.id = t.user_id
  WHERE t.id = token AND t.user_id = owner AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > now());
  IF NOT FOUND OR (k.user_id <> me AND NOT k.is_bot) THEN
    RAISE EXCEPTION 'no such token' USING ERRCODE = 'P0002';
  END IF;
  IF k.user_id <> me THEN
    PERFORM app.managed_bot_scope(k.user_id);
  END IF;
  UPDATE public.api_tokens SET last_viewed_at = now() WHERE id = token;
  RETURN k.token_enc;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.create_bot_token(uuid, text, text[], timestamptz, text, text, text),
  app.create_bot_token(uuid, text, text[], timestamptz, text, text), app.bot_tokens(uuid),
  app.reveal_api_token(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_bot_token(uuid, text, text[], timestamptz, text, text, text),
  app.create_bot_token(uuid, text, text[], timestamptz, text, text), app.bot_tokens(uuid), app.reveal_api_token(uuid, uuid) TO kanban_app;
