-- Account bots: bots owned by a person (users.bot_owner_id) instead of one
-- board (0102) or team (0106). The owner makes, renames and deletes them,
-- manages their tokens and picture, and adds them to boards they own as
-- editor, commenter or viewer (never owner). Board owners change their role or
-- remove them like any member; the bot's owner can also take them off a board.
-- Their tokens have no board or team limit, so they follow the bot's board
-- memberships (RLS does the rest). Deleting the owner's account deletes the
-- bots. At most 20 per person (KB011). Never in teams.

-- ---------------------------------------------------------------- helpers

-- The bot when it is the caller's account bot. Unknown ids and other kinds
-- of bot raise P0002, other people 42501. Not with a limited token.
CREATE FUNCTION app.owned_account_bot(bot uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  o uuid;
BEGIN
  SELECT bot_owner_id INTO o FROM public.users WHERE id = bot AND is_bot;
  IF o IS NULL THEN
    RAISE EXCEPTION 'no such bot' USING ERRCODE = 'P0002';
  END IF;
  IF o IS DISTINCT FROM app.current_user_id()
     OR app.token_board_ids() IS NOT NULL OR app.token_team_id() IS NOT NULL THEN
    RAISE EXCEPTION 'only its owner manages an account bot' USING ERRCODE = '42501';
  END IF;
  RETURN bot;
END
$$;
--> statement-breakpoint

-- As in 0073, plus the caller's own account bots (also those on no board).
CREATE OR REPLACE FUNCTION app.visible_user_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH me AS (SELECT app.current_user_id() AS id),
  my_boards AS (
    SELECT bm.board_id FROM public.board_members bm, me WHERE bm.user_id = me.id
    UNION
    SELECT bd.id FROM public.boards bd
    JOIN public.team_members tm ON tm.team_id = bd.team_id, me
    WHERE tm.user_id = me.id
  )
  SELECT o.user_id FROM public.team_members a
  JOIN public.team_members o ON o.team_id = a.team_id, me
  WHERE a.user_id = me.id
  UNION
  SELECT bm.user_id FROM public.board_members bm
  JOIN my_boards mb ON mb.board_id = bm.board_id
  UNION
  SELECT tm.user_id FROM my_boards mb
  JOIN public.boards bd ON bd.id = mb.board_id
  JOIN public.team_members tm ON tm.team_id = bd.team_id
  UNION
  SELECT u.id FROM public.users u, me WHERE u.bot_owner_id = me.id
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- guards

-- As in 0106, and nobody hands an account bot to another person.
CREATE OR REPLACE FUNCTION app.guard_bot_users() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_bot AND current_user <> (SELECT tableowner FROM pg_catalog.pg_tables
                                       WHERE schemaname = 'public' AND tablename = 'users') THEN
      RAISE EXCEPTION 'bots are made with app.create_board_bot, app.create_team_bot or app.create_account_bot' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_bot AND (NEW.password_hash IS NOT NULL OR NEW.email_verified_at IS NOT NULL) THEN
      RAISE EXCEPTION 'bots cannot sign in' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_bot IS DISTINCT FROM OLD.is_bot OR NEW.bot_board_id IS DISTINCT FROM OLD.bot_board_id
     OR NEW.bot_team_id IS DISTINCT FROM OLD.bot_team_id OR NEW.bot_owner_id IS DISTINCT FROM OLD.bot_owner_id THEN
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

-- As in 0106, plus account bots: only their owner adds them, and only to a
-- board the owner owns (app.board_role, so with a cookie or unlimited token);
-- never as owner. Board owners change their role (not to owner) and remove
-- them like anyone else.
CREATE OR REPLACE FUNCTION app.check_bot_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  bot public.users;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id AND bot_board_id = OLD.board_id)
       AND EXISTS (SELECT 1 FROM public.boards WHERE id = OLD.board_id) THEN
      RAISE EXCEPTION 'delete the bot instead of removing it from its board' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO bot FROM public.users WHERE id = NEW.user_id AND is_bot;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW.role = 'owner' THEN
    RAISE EXCEPTION 'bots are never board owners' USING ERRCODE = '42501';
  END IF;
  IF bot.bot_owner_id IS NOT NULL THEN
    IF (TG_OP = 'INSERT' OR NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.user_id IS DISTINCT FROM OLD.user_id)
       AND (bot.bot_owner_id IS DISTINCT FROM app.current_user_id()
            OR app.board_role(NEW.board_id) IS DISTINCT FROM 'owner') THEN
      RAISE EXCEPTION 'only its owner adds an account bot, to boards they own' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF bot.bot_board_id IS NULL OR NEW.board_id <> bot.bot_board_id THEN
    RAISE EXCEPTION 'bots only join their own board, and never as owner' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- As in 0106, and a person's account bots go first (through this function,
-- so their assignments are removed while their names are still there).
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

  FOR r IN SELECT id FROM public.users WHERE bot_owner_id = u LOOP
    PERFORM app.remove_user_internal(r.id);
  END LOOP;

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

-- ---------------------------------------------------------------- account bots

-- Signed-in people (not bots, not limited tokens) make a bot of their own;
-- returns its id. It starts on no board.
CREATE FUNCTION app.create_account_bot(bot_name text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  me uuid := app.current_user_id();
  bot uuid := gen_random_uuid();
BEGIN
  IF me IS NULL OR app.token_board_ids() IS NOT NULL OR app.token_team_id() IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND NOT is_bot) THEN
    RAISE EXCEPTION 'only people make account bots' USING ERRCODE = '42501';
  END IF;
  PERFORM app.check_bot_fields(bot_name, 'editor');
  -- One at a time per person, so the limit holds under concurrent requests.
  PERFORM pg_advisory_xact_lock(hashtextextended('account-bots:' || me::text, 0));
  IF (SELECT count(*) FROM public.users WHERE bot_owner_id = me) >= 20 THEN
    RAISE EXCEPTION 'at most 20 bots per account' USING ERRCODE = 'KB011';
  END IF;
  INSERT INTO public.users (id, email, name, is_bot, bot_owner_id)
  VALUES (bot, 'bot-' || bot || '@bots.invalid', btrim(bot_name), true, me);
  RETURN bot;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.rename_account_bot(bot uuid, bot_name text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_account_bot(bot);
  PERFORM app.check_bot_fields(bot_name, 'editor');
  UPDATE public.users SET name = btrim(bot_name) WHERE id = bot;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.delete_account_bot(bot uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_account_bot(bot);
  PERFORM app.remove_user_internal(bot);
END
$$;
--> statement-breakpoint

-- The owner adds the bot to a board they own, or changes its role there.
CREATE FUNCTION app.add_account_bot_to_board(bot uuid, b uuid, bot_role public.board_role) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_account_bot(bot);
  IF bot_role IS NULL OR bot_role = 'owner' THEN
    RAISE EXCEPTION 'bots cannot be owners' USING ERRCODE = '42501';
  END IF;
  IF app.board_role(b) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only board owners add members' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.board_members (board_id, user_id, role) VALUES (b, bot, bot_role)
  ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role;
END
$$;
--> statement-breakpoint

-- The owner takes the bot off a board (also one they no longer see).
CREATE FUNCTION app.remove_account_bot_from_board(bot uuid, b uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_account_bot(bot);
  DELETE FROM public.board_members WHERE board_id = b AND user_id = bot;
END
$$;
--> statement-breakpoint

-- The boards of the caller's account bots with the bot's role there, for the
-- owner's bot list (also boards the owner no longer sees: the bot's tokens
-- reach them anyway).
CREATE FUNCTION app.my_bot_boards()
RETURNS TABLE (bot_id uuid, board_id uuid, board_name text, role public.board_role, owner boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT bm.user_id, bm.board_id, b.name, bm.role, app.board_role(b.id) = 'owner'
  FROM public.board_members bm
  JOIN public.boards b ON b.id = bm.board_id
  JOIN public.users u ON u.id = bm.user_id AND u.bot_owner_id = app.current_user_id()
  WHERE app.token_board_ids() IS NULL AND app.token_team_id() IS NULL
  ORDER BY lower(b.name), b.id
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- tokens and pictures

-- As in 0106, plus account bots (their owner only; tokens get neither a board
-- nor a team limit, so create_bot_token, bot_tokens, revoke_bot_token,
-- set_bot_avatar and clear_bot_avatar work for them unchanged).
CREATE OR REPLACE FUNCTION app.managed_bot_scope(bot uuid, OUT board uuid, OUT team uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  o uuid;
BEGIN
  SELECT bot_board_id, bot_team_id, bot_owner_id INTO board, team, o FROM public.users WHERE id = bot AND is_bot;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such bot' USING ERRCODE = 'P0002';
  END IF;
  IF board IS NOT NULL THEN
    PERFORM app.owned_bot_board(bot);
  ELSIF team IS NOT NULL THEN
    PERFORM app.owned_bot_team(bot);
  ELSE
    PERFORM app.owned_account_bot(bot);
  END IF;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app.owned_account_bot(uuid), app.create_account_bot(text),
  app.rename_account_bot(uuid, text), app.delete_account_bot(uuid),
  app.add_account_bot_to_board(uuid, uuid, public.board_role), app.remove_account_bot_from_board(uuid, uuid),
  app.my_bot_boards() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_account_bot(text), app.rename_account_bot(uuid, text),
  app.delete_account_bot(uuid), app.add_account_bot_to_board(uuid, uuid, public.board_role),
  app.remove_account_bot_from_board(uuid, uuid), app.my_bot_boards() TO kanban_app;
--> statement-breakpoint
GRANT SELECT (bot_owner_id) ON users TO kanban_app;
