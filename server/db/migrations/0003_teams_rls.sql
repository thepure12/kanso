-- Teams: a group of people sharing many boards.
-- A team member's role (owner / editor / viewer) applies to every board in the team.
-- A user's effective board role is the strongest of their direct board role and
-- their team role. board_role enum order is owner < editor < viewer, so min() wins.

-- ---------------------------------------------------------------- helpers

CREATE FUNCTION app.team_role(t uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT role FROM public.team_members
  WHERE team_id = t AND user_id = app.current_user_id()
$$;
--> statement-breakpoint

-- Effective role of user u on board b (null = no access).
CREATE FUNCTION app.user_board_role(b uuid, u uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT min(role) FROM (
    SELECT role FROM public.board_members WHERE board_id = b AND user_id = u
    UNION ALL
    SELECT tm.role FROM public.boards bd
    JOIN public.team_members tm ON tm.team_id = bd.team_id
    WHERE bd.id = b AND tm.user_id = u
  ) r
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.board_role(b uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT app.user_board_role(b, app.current_user_id()) $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.is_member(b uuid, u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT app.user_board_role(b, u) IS NOT NULL $$;
--> statement-breakpoint

-- Everyone with access to board b, with their effective, direct and team roles.
-- Returns nothing unless the caller has access to b.
CREATE FUNCTION app.board_people(b uuid)
RETURNS TABLE (user_id uuid, role public.board_role, board_role public.board_role, team_role public.board_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH direct AS (
    SELECT bm.user_id, bm.role FROM public.board_members bm WHERE bm.board_id = b
  ), via_team AS (
    SELECT tm.user_id, tm.role FROM public.boards bd
    JOIN public.team_members tm ON tm.team_id = bd.team_id
    WHERE bd.id = b
  )
  SELECT u.user_id,
         least(d.role, t.role),
         d.role,
         t.role
  FROM (SELECT direct.user_id FROM direct UNION SELECT via_team.user_id FROM via_team) u
  LEFT JOIN direct d ON d.user_id = u.user_id
  LEFT JOIN via_team t ON t.user_id = u.user_id
  WHERE app.board_role(b) IS NOT NULL
$$;
--> statement-breakpoint

-- Users visible to the caller: anyone in a shared team, or anyone with access
-- to a board the caller can access.
CREATE OR REPLACE FUNCTION app.shares_board(u uuid) RETURNS boolean
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
  SELECT EXISTS (
    SELECT 1 FROM public.team_members a
    JOIN public.team_members o ON o.team_id = a.team_id, me
    WHERE a.user_id = me.id AND o.user_id = u
  ) OR EXISTS (
    SELECT 1 FROM my_boards WHERE app.user_board_role(my_boards.board_id, u) IS NOT NULL
  )
$$;
--> statement-breakpoint

-- Personal boards get the creator as direct owner. Team boards get no direct
-- members: access comes from the team. Team owners and editors may create them.
DROP FUNCTION app.create_board(text);
--> statement-breakpoint
CREATE FUNCTION app.create_board(board_name text, team uuid DEFAULT NULL) RETURNS public.boards
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  uid uuid := app.current_user_id();
  b public.boards;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF team IS NOT NULL AND coalesce(app.team_role(team) IN ('owner', 'editor'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'only team owners and editors can create team boards' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.boards (name, owner_id, team_id) VALUES (board_name, uid, team) RETURNING * INTO b;
  IF team IS NULL THEN
    INSERT INTO public.board_members (board_id, user_id, role) VALUES (b.id, uid, 'owner');
  END IF;
  RETURN b;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.create_team(team_name text) RETURNS public.teams
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  uid uuid := app.current_user_id();
  t public.teams;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.teams (name) VALUES (team_name) RETURNING * INTO t;
  INSERT INTO public.team_members (team_id, user_id, role) VALUES (t.id, uid, 'owner');
  RETURN t;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.add_team_member(t uuid, member_email text, member_role public.board_role)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  target uuid;
BEGIN
  IF app.team_role(t) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only team owners can add members' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO target FROM public.users WHERE email = member_email::citext;
  IF target IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (t, target, member_role)
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role;
  RETURN target;
END
$$;
--> statement-breakpoint

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO kanban_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- triggers

-- Team boards are owned through the team, so they need no direct owner.
CREATE OR REPLACE FUNCTION app.keep_last_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner')
     AND EXISTS (SELECT 1 FROM public.boards WHERE id = OLD.board_id AND team_id IS NULL)
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

CREATE FUNCTION app.keep_last_team_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner')
     AND EXISTS (SELECT 1 FROM public.teams WHERE id = OLD.team_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members
       WHERE team_id = OLD.team_id AND role = 'owner' AND user_id <> OLD.user_id
     )
  THEN
    RAISE EXCEPTION 'a team must keep at least one owner' USING ERRCODE = '23514';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER team_members_keep_last_owner
BEFORE UPDATE OR DELETE ON team_members
FOR EACH ROW EXECUTE FUNCTION app.keep_last_team_owner();
--> statement-breakpoint

-- ---------------------------------------------------------------- grants

-- A board's team is fixed at creation.
REVOKE UPDATE ON boards FROM kanban_app;
--> statement-breakpoint
GRANT UPDATE (name) ON boards TO kanban_app;
--> statement-breakpoint
GRANT SELECT, UPDATE (name), DELETE ON teams TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON team_members TO kanban_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- policies

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- teams (insert only through app.create_team)
CREATE POLICY teams_select ON teams FOR SELECT TO kanban_app
  USING (app.team_role(id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY teams_update ON teams FOR UPDATE TO kanban_app
  USING (app.team_role(id) = 'owner') WITH CHECK (app.team_role(id) = 'owner');
--> statement-breakpoint
CREATE POLICY teams_delete ON teams FOR DELETE TO kanban_app
  USING (app.team_role(id) = 'owner');
--> statement-breakpoint

-- team_members
CREATE POLICY team_members_select ON team_members FOR SELECT TO kanban_app
  USING (app.team_role(team_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY team_members_insert ON team_members FOR INSERT TO kanban_app
  WITH CHECK (app.team_role(team_id) = 'owner');
--> statement-breakpoint
CREATE POLICY team_members_update ON team_members FOR UPDATE TO kanban_app
  USING (app.team_role(team_id) = 'owner') WITH CHECK (app.team_role(team_id) = 'owner');
--> statement-breakpoint
-- Owners remove anyone; any member can leave.
CREATE POLICY team_members_delete ON team_members FOR DELETE TO kanban_app
  USING (app.team_role(team_id) = 'owner' OR user_id = app.current_user_id());
