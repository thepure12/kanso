-- Row-level security.
--
-- Roles (see docker/init.sql):
--   kanban_owner  owns every table and function. RLS is ENABLEd (not FORCEd), so
--                 SECURITY DEFINER helpers owned by it can read membership without
--                 recursing into policies.
--   kanban_app    runtime role. Not an owner, NOBYPASSRLS: every query is filtered.
--                 Identity comes from the transaction-local setting app.user_id.
--   kanban_auth   login / register / OAuth only. Sees users + oauth_accounts.

CREATE SCHEMA app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO kanban_app, kanban_auth;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO kanban_app, kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- helpers

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app.board_role(b uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT role FROM public.board_members
  WHERE board_id = b AND user_id = app.current_user_id()
$$;
--> statement-breakpoint

CREATE FUNCTION app.can_edit(b uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app.board_role(b) IN ('owner', 'editor'), false) $$;
--> statement-breakpoint

CREATE FUNCTION app.is_member(b uuid, u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT 1 FROM public.board_members WHERE board_id = b AND user_id = u) $$;
--> statement-breakpoint

CREATE FUNCTION app.shares_board(u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_members me
    JOIN public.board_members other ON other.board_id = me.board_id
    WHERE me.user_id = app.current_user_id() AND other.user_id = u
  )
$$;
--> statement-breakpoint

-- Creating a board and its owner membership must be atomic, and the creator is
-- not yet a member when the board row is inserted, so it goes through a function.
CREATE FUNCTION app.create_board(board_name text) RETURNS public.boards
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  uid uuid := app.current_user_id();
  b public.boards;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.boards (name, owner_id) VALUES (board_name, uid) RETURNING * INTO b;
  INSERT INTO public.board_members (board_id, user_id, role) VALUES (b.id, uid, 'owner');
  RETURN b;
END
$$;
--> statement-breakpoint

-- Owners add people by email. The caller cannot read arbitrary users, so the
-- lookup happens here after the owner check.
CREATE FUNCTION app.add_board_member(b uuid, member_email text, member_role public.board_role)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  target uuid;
BEGIN
  IF app.board_role(b) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only board owners can add members' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO target FROM public.users WHERE email = member_email::citext;
  IF target IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.board_members (board_id, user_id, role)
  VALUES (b, target, member_role)
  ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role;
  RETURN target;
END
$$;
--> statement-breakpoint

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO kanban_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- triggers

-- A board always keeps at least one owner. Skipped when the board itself is
-- being deleted (cascade).
CREATE FUNCTION app.keep_last_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner')
     AND EXISTS (SELECT 1 FROM public.boards WHERE id = OLD.board_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.board_members
       WHERE board_id = OLD.board_id AND role = 'owner' AND user_id <> OLD.user_id
     )
  THEN
    RAISE EXCEPTION 'a board must keep at least one owner' USING ERRCODE = '23514';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER board_members_keep_last_owner
BEFORE UPDATE OR DELETE ON board_members
FOR EACH ROW EXECUTE FUNCTION app.keep_last_owner();
--> statement-breakpoint

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER cards_touch_updated_at
BEFORE UPDATE ON cards
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint

-- ---------------------------------------------------------------- grants
-- password_hash is never readable by kanban_app (column-level grant).

GRANT SELECT (id, email, name, avatar_url, created_at), UPDATE (name, avatar_url) ON users TO kanban_app;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON boards TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON board_members, columns, cards TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users, oauth_accounts TO kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- policies

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE oauth_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE board_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE columns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- users
CREATE POLICY users_select ON users FOR SELECT TO kanban_app
  USING (id = app.current_user_id() OR app.shares_board(id));
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO kanban_app
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY users_auth ON users FOR ALL TO kanban_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY oauth_accounts_auth ON oauth_accounts FOR ALL TO kanban_auth USING (true) WITH CHECK (true);
--> statement-breakpoint

-- boards (insert only through app.create_board)
CREATE POLICY boards_select ON boards FOR SELECT TO kanban_app
  USING (app.board_role(id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY boards_update ON boards FOR UPDATE TO kanban_app
  USING (app.board_role(id) = 'owner') WITH CHECK (app.board_role(id) = 'owner');
--> statement-breakpoint
CREATE POLICY boards_delete ON boards FOR DELETE TO kanban_app
  USING (app.board_role(id) = 'owner');
--> statement-breakpoint

-- board_members
CREATE POLICY members_select ON board_members FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY members_insert ON board_members FOR INSERT TO kanban_app
  WITH CHECK (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY members_update ON board_members FOR UPDATE TO kanban_app
  USING (app.board_role(board_id) = 'owner') WITH CHECK (app.board_role(board_id) = 'owner');
--> statement-breakpoint
-- Owners remove anyone; any member can leave.
CREATE POLICY members_delete ON board_members FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner' OR user_id = app.current_user_id());
--> statement-breakpoint

-- columns
CREATE POLICY columns_select ON columns FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY columns_insert ON columns FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY columns_update ON columns FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY columns_delete ON columns FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint

-- cards
CREATE POLICY cards_select ON cards FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY cards_insert ON cards FOR INSERT TO kanban_app
  WITH CHECK (
    app.can_edit(board_id)
    AND created_by = app.current_user_id()
    AND (assignee_id IS NULL OR app.is_member(board_id, assignee_id))
  );
--> statement-breakpoint
CREATE POLICY cards_update ON cards FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id))
  WITH CHECK (app.can_edit(board_id) AND (assignee_id IS NULL OR app.is_member(board_id, assignee_id)));
--> statement-breakpoint
CREATE POLICY cards_delete ON cards FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
