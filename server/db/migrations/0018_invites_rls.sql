-- Invites: adding an email that has no account records a pending membership.
-- When that email signs up, app.claim_invites turns its invites into board or
-- team memberships. app.has_invite lets the restricted sign-up gate admit
-- invited emails without kanban_auth reading the table.

CREATE OR REPLACE FUNCTION app.add_board_member(b uuid, member_email text, member_role public.board_role)
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
    INSERT INTO public.invites (email, board_id, role, invited_by)
    VALUES (member_email, b, member_role, app.current_user_id())
    ON CONFLICT (email, board_id) WHERE board_id IS NOT NULL DO UPDATE SET role = excluded.role;
    RETURN NULL;
  END IF;
  INSERT INTO public.board_members (board_id, user_id, role)
  VALUES (b, target, member_role)
  ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role;
  RETURN target;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.add_team_member(t uuid, member_email text, member_role public.board_role)
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
    INSERT INTO public.invites (email, team_id, role, invited_by)
    VALUES (member_email, t, member_role, app.current_user_id())
    ON CONFLICT (email, team_id) WHERE team_id IS NOT NULL DO UPDATE SET role = excluded.role;
    RETURN NULL;
  END IF;
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (t, target, member_role)
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role;
  RETURN target;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.claim_invites() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.board_members (board_id, user_id, role)
  SELECT board_id, NEW.id, role FROM public.invites WHERE email = NEW.email AND board_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO public.team_members (team_id, user_id, role)
  SELECT team_id, NEW.id, role FROM public.invites WHERE email = NEW.email AND team_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  DELETE FROM public.invites WHERE email = NEW.email;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.claim_invites() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER users_claim_invites AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION app.claim_invites();
--> statement-breakpoint

CREATE FUNCTION app.has_invite(member_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.invites WHERE email = member_email::citext)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.has_invite(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.has_invite(text) TO kanban_auth;
--> statement-breakpoint

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, DELETE ON invites TO kanban_app;
--> statement-breakpoint
-- Visible to everyone who can see the member list; only owners revoke.
CREATE POLICY invites_select ON invites FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL OR app.team_role(team_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY invites_delete ON invites FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner' OR app.team_role(team_id) = 'owner');
--> statement-breakpoint

CREATE TRIGGER invites_board_notify AFTER INSERT OR UPDATE OR DELETE ON invites
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER invites_team_notify AFTER INSERT OR UPDATE OR DELETE ON invites
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('team_id', 'team');
