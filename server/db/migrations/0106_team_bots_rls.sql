-- Team bots: like board bots (0102), but for a whole team. A team bot
-- (users.bot_team_id) is a team member with editor, commenter or viewer role,
-- so it reaches every board of the team, later ones too, through
-- app.team_role. Team owners manage it. It never signs in and acts only
-- through API tokens limited to its team (api_tokens.team_id): such a token
-- reaches only the team's boards and keeps the team role (a board-limited
-- token is capped at team viewer). Deleting the team deletes its bots and
-- their tokens.

-- ---------------------------------------------------------------- team-limited tokens

CREATE FUNCTION app.token_team_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.token_team', true), '')::uuid $$;
--> statement-breakpoint

-- As in 0054, plus: a team-limited token reaches only boards of its team.
-- SECURITY DEFINER for the boards lookup (it is also called from policies).
CREATE OR REPLACE FUNCTION app.token_allows(b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT (app.token_board_ids() IS NULL OR b = ANY (app.token_board_ids()))
     AND CASE WHEN app.token_team_id() IS NULL THEN true
              ELSE EXISTS (SELECT 1 FROM public.boards WHERE id = b AND team_id = app.token_team_id()) END
$$;
--> statement-breakpoint

-- As in 0054: board-limited tokens act as team viewers at most; a
-- team-limited token sees no other team and keeps the role in its own.
CREATE OR REPLACE FUNCTION app.team_role(t uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN app.token_board_ids() IS NULL THEN role ELSE greatest(role, 'viewer') END
  FROM public.team_members
  WHERE team_id = t AND user_id = app.current_user_id()
    AND (app.token_team_id() IS NULL OR t = app.token_team_id())
$$;
--> statement-breakpoint

-- Limited tokens of either kind create no boards or teams.
CREATE OR REPLACE FUNCTION app.refuse_limited_token() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app.token_board_ids() IS NOT NULL OR app.token_team_id() IS NOT NULL THEN
    RAISE EXCEPTION 'this API token is limited to some boards' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Leaving a team: not with a limited token of either kind.
DROP POLICY team_members_delete ON team_members;
--> statement-breakpoint
CREATE POLICY team_members_delete ON team_members FOR DELETE TO kanban_app
  USING (app.team_role(team_id) = 'owner'
    OR (user_id = app.current_user_id() AND app.token_board_ids() IS NULL AND app.token_team_id() IS NULL));
--> statement-breakpoint

-- People's own tokens are never team-limited (only app.create_bot_token makes those).
DROP POLICY api_tokens_insert ON api_tokens;
--> statement-breakpoint
CREATE POLICY api_tokens_insert ON api_tokens FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND revoked_at IS NULL AND last_used_at IS NULL AND team_id IS NULL
    AND (board_ids IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(board_ids) b WHERE app.board_role(b) IS NULL)));
--> statement-breakpoint

DROP FUNCTION app.resolve_api_token(text);
--> statement-breakpoint
CREATE FUNCTION app.resolve_api_token(hash text)
RETURNS TABLE (token_id uuid, user_id uuid, scopes text[], board_ids uuid[], team_id uuid)
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
  RETURN QUERY SELECT t.id, t.user_id, t.scopes, t.board_ids, t.team_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_api_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_api_token(text) TO kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- guards

-- As in 0102, and nobody moves a bot to another team either.
CREATE OR REPLACE FUNCTION app.guard_bot_users() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_bot AND current_user <> (SELECT tableowner FROM pg_catalog.pg_tables
                                       WHERE schemaname = 'public' AND tablename = 'users') THEN
      RAISE EXCEPTION 'bots are made with app.create_board_bot or app.create_team_bot' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_bot AND (NEW.password_hash IS NOT NULL OR NEW.email_verified_at IS NOT NULL) THEN
      RAISE EXCEPTION 'bots cannot sign in' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_bot IS DISTINCT FROM OLD.is_bot OR NEW.bot_board_id IS DISTINCT FROM OLD.bot_board_id
     OR NEW.bot_team_id IS DISTINCT FROM OLD.bot_team_id THEN
    RAISE EXCEPTION 'an account cannot become a bot or stop being one' USING ERRCODE = '42501';
  END IF;
  IF OLD.is_bot AND (NEW.email IS DISTINCT FROM OLD.email OR NEW.password_hash IS NOT NULL
                     OR NEW.email_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'bots cannot sign in' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- As in 0102; team bots never get a board membership of their own (they
-- reach the team's boards through the team).
CREATE OR REPLACE FUNCTION app.check_bot_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  home uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id AND bot_board_id = OLD.board_id)
       AND EXISTS (SELECT 1 FROM public.boards WHERE id = OLD.board_id) THEN
      RAISE EXCEPTION 'delete the bot instead of removing it from its board' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  SELECT bot_board_id INTO home FROM public.users WHERE id = NEW.user_id AND is_bot;
  IF FOUND AND (home IS NULL OR NEW.board_id <> home OR NEW.role = 'owner') THEN
    RAISE EXCEPTION 'bots only join their own board, and never as owner' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- team_members (replaces 0102's "bots never join teams"): a team bot is only
-- ever a member of its own team, never as owner, and leaves it only by being
-- deleted (directly or with the team). Board bots join no team.
CREATE OR REPLACE FUNCTION app.refuse_bot_team_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  home uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id AND bot_team_id = OLD.team_id)
       AND EXISTS (SELECT 1 FROM public.teams WHERE id = OLD.team_id) THEN
      RAISE EXCEPTION 'delete the bot instead of removing it from its team' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  SELECT bot_team_id INTO home FROM public.users WHERE id = NEW.user_id AND is_bot;
  IF FOUND AND (home IS NULL OR NEW.team_id <> home OR NEW.role = 'owner') THEN
    RAISE EXCEPTION 'bots only join their own team, and never as owner' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER team_members_refuse_bots ON team_members;
--> statement-breakpoint
CREATE TRIGGER team_members_check_bots BEFORE INSERT OR UPDATE OR DELETE ON team_members
FOR EACH ROW EXECUTE FUNCTION app.refuse_bot_team_member();
--> statement-breakpoint

-- As in 0024, but a bot never inherits a board or team (it can never be an
-- owner): without a human heir the board or team is deleted.
CREATE OR REPLACE FUNCTION app.remove_user_internal(u uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r record;
  heir uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = u) THEN
    RAISE EXCEPTION 'no such user' USING ERRCODE = 'P0002';
  END IF;

  FOR r IN
    SELECT bm.board_id FROM public.board_members bm
    JOIN public.boards b ON b.id = bm.board_id AND b.team_id IS NULL
    WHERE bm.user_id = u AND bm.role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM public.board_members o
                      WHERE o.board_id = bm.board_id AND o.role = 'owner' AND o.user_id <> u)
  LOOP
    SELECT m.user_id INTO heir FROM public.board_members m
    JOIN public.users p ON p.id = m.user_id AND NOT p.is_bot
    WHERE m.board_id = r.board_id AND m.user_id <> u ORDER BY m.role, m.created_at LIMIT 1;
    IF heir IS NULL THEN
      DELETE FROM public.boards WHERE id = r.board_id;
    ELSE
      UPDATE public.board_members SET role = 'owner' WHERE board_id = r.board_id AND user_id = heir;
    END IF;
  END LOOP;

  FOR r IN
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = u AND tm.role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM public.team_members o
                      WHERE o.team_id = tm.team_id AND o.role = 'owner' AND o.user_id <> u)
  LOOP
    SELECT m.user_id INTO heir FROM public.team_members m
    JOIN public.users p ON p.id = m.user_id AND NOT p.is_bot
    WHERE m.team_id = r.team_id AND m.user_id <> u ORDER BY m.role, m.created_at LIMIT 1;
    IF heir IS NULL THEN
      DELETE FROM public.teams WHERE id = r.team_id;
    ELSE
      UPDATE public.team_members SET role = 'owner' WHERE team_id = r.team_id AND user_id = heir;
    END IF;
  END LOOP;

  -- Before the user row goes, so the activity log still has the name.
  DELETE FROM public.card_assignees WHERE user_id = u;
  DELETE FROM public.users WHERE id = u;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- team bots

-- The bot's team when the caller is an owner of it (through app.team_role,
-- so a limited token never qualifies). Unknown ids and non-team-bots raise
-- P0002, other callers 42501.
CREATE FUNCTION app.owned_bot_team(bot uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  t uuid;
BEGIN
  SELECT bot_team_id INTO t FROM public.users WHERE id = bot AND is_bot;
  IF t IS NULL THEN
    RAISE EXCEPTION 'no such bot' USING ERRCODE = 'P0002';
  END IF;
  IF app.team_role(t) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only team owners can manage its bots' USING ERRCODE = '42501';
  END IF;
  RETURN t;
END
$$;
--> statement-breakpoint

-- Team owners add a bot; returns its user id.
CREATE FUNCTION app.create_team_bot(t uuid, bot_name text, bot_role public.board_role) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  bot uuid := gen_random_uuid();
BEGIN
  IF app.team_role(t) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only team owners can add bots' USING ERRCODE = '42501';
  END IF;
  PERFORM app.check_bot_fields(bot_name, bot_role);
  INSERT INTO public.users (id, email, name, is_bot, bot_team_id)
  VALUES (bot, 'bot-' || bot || '@bots.invalid', btrim(bot_name), true, t);
  INSERT INTO public.team_members (team_id, user_id, role) VALUES (t, bot, bot_role);
  RETURN bot;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.update_team_bot(bot uuid, bot_name text, bot_role public.board_role) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  t uuid := app.owned_bot_team(bot);
BEGIN
  PERFORM app.check_bot_fields(bot_name, bot_role);
  UPDATE public.users SET name = btrim(bot_name) WHERE id = bot;
  UPDATE public.team_members SET role = bot_role WHERE team_id = t AND user_id = bot;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.delete_team_bot(bot uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_bot_team(bot);
  PERFORM app.remove_user_internal(bot);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- tokens of either kind

-- Checks that the caller manages the bot (owner of its board or team) and
-- returns the bot's board and team (one of them null).
CREATE FUNCTION app.managed_bot_scope(bot uuid, OUT board uuid, OUT team uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  SELECT bot_board_id, bot_team_id INTO board, team FROM public.users WHERE id = bot AND is_bot;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such bot' USING ERRCODE = 'P0002';
  END IF;
  IF board IS NOT NULL THEN
    PERFORM app.owned_bot_board(bot);
  ELSE
    PERFORM app.owned_bot_team(bot);
  END IF;
END
$$;
--> statement-breakpoint

-- As in 0102; a team bot's token reaches its team's boards (team_id), a
-- board bot's its board (board_ids).
CREATE OR REPLACE FUNCTION app.create_bot_token(bot uuid, token_name text, token_scopes text[],
  token_expires_at timestamptz, token_hash text, token_prefix text) RETURNS uuid
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
  INSERT INTO public.api_tokens (user_id, name, token_hash, prefix, scopes, board_ids, team_id, expires_at)
  VALUES (bot, btrim(token_name), token_hash, token_prefix,
          ARRAY(SELECT DISTINCT unnest(token_scopes) ORDER BY 1),
          CASE WHEN s.board IS NULL THEN NULL ELSE ARRAY[s.board] END, s.team, token_expires_at)
  RETURNING id INTO tid;
  RETURN tid;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.bot_tokens(bot uuid)
RETURNS TABLE (id uuid, name text, prefix text, scopes text[], created_at timestamptz,
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.managed_bot_scope(bot);
  RETURN QUERY
  SELECT k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.expires_at, k.revoked_at
  FROM public.api_tokens k WHERE k.user_id = bot
  ORDER BY k.created_at DESC, k.id;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.revoke_bot_token(token uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  bot uuid;
BEGIN
  SELECT k.user_id INTO bot FROM public.api_tokens k
  JOIN public.users u ON u.id = k.user_id AND u.is_bot
  WHERE k.id = token;
  IF bot IS NULL THEN
    RAISE EXCEPTION 'no such token' USING ERRCODE = 'P0002';
  END IF;
  PERFORM app.managed_bot_scope(bot);
  UPDATE public.api_tokens SET revoked_at = now() WHERE id = token AND revoked_at IS NULL;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app.owned_bot_team(uuid),
  app.create_team_bot(uuid, text, public.board_role), app.update_team_bot(uuid, text, public.board_role),
  app.delete_team_bot(uuid), app.managed_bot_scope(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_team_bot(uuid, text, public.board_role),
  app.update_team_bot(uuid, text, public.board_role), app.delete_team_bot(uuid) TO kanban_app;
--> statement-breakpoint
GRANT SELECT (bot_team_id) ON users TO kanban_app;
