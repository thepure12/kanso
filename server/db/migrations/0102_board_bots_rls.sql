-- Board bots: users that exist only for one board (users.is_bot,
-- users.bot_board_id), made and managed by the board's effective owners. A
-- bot is a member of its board with editor, commenter or viewer role, never
-- signs in (placeholder email bot-<id>@bots.invalid, no password, never
-- verified, no OAuth rows, no sessions) and acts only through API tokens
-- limited to its board. Deleting the board deletes the bot (FK cascade) and
-- with it its tokens.

-- ---------------------------------------------------------------- helpers

-- The bot's board when the caller is an effective owner of it (through
-- app.board_role, so a board-limited token must reach that board). Unknown
-- ids and non-bots raise P0002, other callers 42501.
CREATE FUNCTION app.owned_bot_board(bot uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  b uuid;
BEGIN
  SELECT bot_board_id INTO b FROM public.users WHERE id = bot AND is_bot;
  IF b IS NULL THEN
    RAISE EXCEPTION 'no such bot' USING ERRCODE = 'P0002';
  END IF;
  IF app.board_role(b) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only board owners can manage its bots' USING ERRCODE = '42501';
  END IF;
  RETURN b;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.check_bot_fields(bot_name text, bot_role public.board_role) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
AS $$
BEGIN
  IF bot_name IS NULL OR length(btrim(bot_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'bot names have 1 to 100 characters' USING ERRCODE = '22023';
  END IF;
  IF bot_role IS NULL OR bot_role = 'owner' THEN
    RAISE EXCEPTION 'bots cannot be owners' USING ERRCODE = '42501';
  END IF;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- triggers

-- users: only the functions below (running as the table owner) create bots;
-- nobody turns an account into a bot or back, moves a bot to another board,
-- or gives a bot a way to sign in (email, password, verification). Not
-- SECURITY DEFINER, so current_user is the caller (or the table owner inside
-- the SECURITY DEFINER functions).
CREATE FUNCTION app.guard_bot_users() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_bot AND current_user <> (SELECT tableowner FROM pg_catalog.pg_tables
                                       WHERE schemaname = 'public' AND tablename = 'users') THEN
      RAISE EXCEPTION 'bots are made with app.create_board_bot' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_bot AND (NEW.password_hash IS NOT NULL OR NEW.email_verified_at IS NOT NULL) THEN
      RAISE EXCEPTION 'bots cannot sign in' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_bot IS DISTINCT FROM OLD.is_bot OR NEW.bot_board_id IS DISTINCT FROM OLD.bot_board_id THEN
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
CREATE TRIGGER users_guard_bots BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION app.guard_bot_users();
--> statement-breakpoint

-- Bots never link an OAuth account or start a session.
CREATE FUNCTION app.refuse_bot_sign_in() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = NEW.user_id AND is_bot) THEN
    RAISE EXCEPTION 'bots cannot sign in' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER oauth_accounts_refuse_bots BEFORE INSERT OR UPDATE ON oauth_accounts
FOR EACH ROW EXECUTE FUNCTION app.refuse_bot_sign_in();
--> statement-breakpoint
CREATE TRIGGER user_sessions_refuse_bots BEFORE INSERT OR UPDATE ON user_sessions
FOR EACH ROW EXECUTE FUNCTION app.refuse_bot_sign_in();
--> statement-breakpoint
-- Admins are verified accounts already (app.is_verified, bootstrap_admin);
-- this keeps it so whatever the path.
CREATE TRIGGER instance_admins_refuse_bots BEFORE INSERT OR UPDATE ON instance_admins
FOR EACH ROW EXECUTE FUNCTION app.refuse_bot_sign_in();
--> statement-breakpoint

-- board_members: a bot is only ever a member of its own board, never as
-- owner (so never the last owner), and leaves it only by being deleted
-- (directly or with the board, when the user or board row is already gone).
CREATE FUNCTION app.check_bot_membership() RETURNS trigger
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
  IF FOUND AND (NEW.board_id <> home OR NEW.role = 'owner') THEN
    RAISE EXCEPTION 'bots only join their own board, and never as owner' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER board_members_check_bots BEFORE INSERT OR UPDATE OR DELETE ON board_members
FOR EACH ROW EXECUTE FUNCTION app.check_bot_membership();
--> statement-breakpoint

-- team_members: bots are never in a team.
CREATE FUNCTION app.refuse_bot_team_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = NEW.user_id AND is_bot) THEN
    RAISE EXCEPTION 'bots cannot join teams' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER team_members_refuse_bots BEFORE INSERT OR UPDATE ON team_members
FOR EACH ROW EXECUTE FUNCTION app.refuse_bot_team_member();
--> statement-breakpoint

-- ---------------------------------------------------------------- bots

-- Effective board owners add a bot; returns its user id.
CREATE FUNCTION app.create_board_bot(b uuid, bot_name text, bot_role public.board_role) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  bot uuid := gen_random_uuid();
BEGIN
  IF app.board_role(b) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only board owners can add bots' USING ERRCODE = '42501';
  END IF;
  PERFORM app.check_bot_fields(bot_name, bot_role);
  INSERT INTO public.users (id, email, name, is_bot, bot_board_id)
  VALUES (bot, 'bot-' || bot || '@bots.invalid', btrim(bot_name), true, b);
  INSERT INTO public.board_members (board_id, user_id, role) VALUES (b, bot, bot_role);
  RETURN bot;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.update_board_bot(bot uuid, bot_name text, bot_role public.board_role) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  b uuid := app.owned_bot_board(bot);
BEGIN
  PERFORM app.check_bot_fields(bot_name, bot_role);
  UPDATE public.users SET name = btrim(bot_name) WHERE id = bot;
  UPDATE public.board_members SET role = bot_role WHERE board_id = b AND user_id = bot;
END
$$;
--> statement-breakpoint

-- Like removing an account: cards, comments and activity stay with a null
-- creator/actor, assignments go, tokens are deleted with the user row.
CREATE FUNCTION app.delete_board_bot(bot uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_bot_board(bot);
  PERFORM app.remove_user_internal(bot);
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- tokens

-- Owners create a token for a bot. The app makes the token and passes its
-- sha256 and display prefix (like /api/account/tokens); the token always
-- reaches only the bot's board. Returns the token id.
CREATE FUNCTION app.create_bot_token(bot uuid, token_name text, token_scopes text[],
  token_expires_at timestamptz, token_hash text, token_prefix text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  b uuid := app.owned_bot_board(bot);
  tid uuid;
BEGIN
  IF token_name IS NULL OR length(btrim(token_name)) NOT BETWEEN 1 AND 100
     OR token_scopes IS NULL OR cardinality(token_scopes) = 0
     OR NOT token_scopes <@ ARRAY['read', 'write']
     OR (token_expires_at IS NOT NULL AND token_expires_at <= now())
     OR token_hash IS NULL OR token_prefix IS NULL THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.api_tokens (user_id, name, token_hash, prefix, scopes, board_ids, expires_at)
  VALUES (bot, btrim(token_name), token_hash, token_prefix,
          ARRAY(SELECT DISTINCT unnest(token_scopes) ORDER BY 1), ARRAY[b], token_expires_at)
  RETURNING id INTO tid;
  RETURN tid;
END
$$;
--> statement-breakpoint

-- A bot's tokens (never the hash), newest first, for owners of its board.
CREATE FUNCTION app.bot_tokens(bot uuid)
RETURNS TABLE (id uuid, name text, prefix text, scopes text[], created_at timestamptz,
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_bot_board(bot);
  RETURN QUERY
  SELECT k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.expires_at, k.revoked_at
  FROM public.api_tokens k WHERE k.user_id = bot
  ORDER BY k.created_at DESC, k.id;
END
$$;
--> statement-breakpoint

-- Owners of the bot's board revoke one of its tokens (already revoked: no-op).
CREATE FUNCTION app.revoke_bot_token(token uuid) RETURNS void
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
  PERFORM app.owned_bot_board(bot);
  UPDATE public.api_tokens SET revoked_at = now() WHERE id = token AND revoked_at IS NULL;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app.owned_bot_board(uuid), app.check_bot_fields(text, public.board_role),
  app.guard_bot_users(), app.refuse_bot_sign_in(), app.check_bot_membership(), app.refuse_bot_team_member(),
  app.create_board_bot(uuid, text, public.board_role), app.update_board_bot(uuid, text, public.board_role),
  app.delete_board_bot(uuid), app.create_bot_token(uuid, text, text[], timestamptz, text, text),
  app.bot_tokens(uuid), app.revoke_bot_token(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_board_bot(uuid, text, public.board_role),
  app.update_board_bot(uuid, text, public.board_role), app.delete_board_bot(uuid),
  app.create_bot_token(uuid, text, text[], timestamptz, text, text), app.bot_tokens(uuid),
  app.revoke_bot_token(uuid) TO kanban_app;
--> statement-breakpoint
-- The app tells bots apart (member lists, people suggestions, admin list).
GRANT SELECT (is_bot, bot_board_id) ON users TO kanban_app;
