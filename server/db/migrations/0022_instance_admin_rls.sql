-- Instance administration. Sign-up settings move from env vars into the
-- single-row instance_settings table, edited by instance admins. The admin
-- named in NUXT_ADMIN_EMAIL is added on sign-in through app.bootstrap_admin;
-- admins promote others and remove accounts. The sign-up gate and the invite
-- restriction are decided here, so the app only asks.

INSERT INTO instance_settings DEFAULT VALUES;
--> statement-breakpoint

-- ---------------------------------------------------------------- helpers

CREATE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT 1 FROM public.instance_admins WHERE user_id = app.current_user_id()) $$;
--> statement-breakpoint

CREATE FUNCTION app.is_verified(u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = u AND email_verified_at IS NOT NULL) $$;
--> statement-breakpoint

-- True when the settings let this email in without an invite.
CREATE FUNCTION app.email_allowlisted(e text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT s.signup_mode = 'open'
      OR lower(e) = ANY (s.allowed_emails)
      OR substring(lower(e) FROM '@([^@]*)$') = ANY (s.allowed_domains)
  FROM public.instance_settings s
$$;
--> statement-breakpoint

-- The sign-up gate (kanban_auth). An invite admits an email outside the
-- allowlist only when allow_external_invites is set.
CREATE FUNCTION app.signup_allowed(e text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT app.email_allowlisted(e) OR (s.allow_external_invites AND app.has_invite(e))
  FROM public.instance_settings s
$$;
--> statement-breakpoint

-- Called by kanban_auth when the NUXT_ADMIN_EMAIL account signs in. Only a
-- verified account with that exact email becomes admin, so registering the
-- address without owning it gains nothing.
CREATE FUNCTION app.bootstrap_admin(u uuid, admin_email text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.instance_admins (user_id)
  SELECT id FROM public.users
  WHERE id = u AND email = admin_email::citext AND email_verified_at IS NOT NULL
  ON CONFLICT DO NOTHING
$$;
--> statement-breakpoint

-- Owners may invite an unknown email only if it could then sign up.
CREATE FUNCTION app.assert_invite_allowed(e text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT app.email_allowlisted(e)
     AND NOT (SELECT allow_external_invites FROM public.instance_settings) THEN
    RAISE EXCEPTION 'invites are limited to allowed email addresses' USING ERRCODE = 'KB001';
  END IF;
END
$$;
--> statement-breakpoint

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
    PERFORM app.assert_invite_allowed(member_email);
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
    PERFORM app.assert_invite_allowed(member_email);
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

-- Admins remove an account (not their own). Personal boards and teams where
-- the user is the last owner pass to their strongest, longest-standing other
-- member, or are deleted when nobody else is in them. Cards, comments and
-- attachments the user created stay (their creator becomes null).
CREATE FUNCTION app.remove_user(u uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r record;
  heir uuid;
BEGIN
  IF NOT app.is_admin() OR u = app.current_user_id() THEN
    RAISE EXCEPTION 'only admins can remove other users' USING ERRCODE = '42501';
  END IF;
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
    SELECT user_id INTO heir FROM public.board_members
    WHERE board_id = r.board_id AND user_id <> u ORDER BY role, created_at LIMIT 1;
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
    SELECT user_id INTO heir FROM public.team_members
    WHERE team_id = r.team_id AND user_id <> u ORDER BY role, created_at LIMIT 1;
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

-- At least one admin stays (skipped when the user row itself is deleted).
CREATE FUNCTION app.keep_last_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.instance_admins WHERE user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'there must be at least one admin left' USING ERRCODE = 'KB002';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER instance_admins_keep_last BEFORE DELETE ON instance_admins
FOR EACH ROW EXECUTE FUNCTION app.keep_last_admin();
--> statement-breakpoint

CREATE FUNCTION app.touch_settings() RETURNS trigger
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER instance_settings_touch BEFORE UPDATE ON instance_settings
FOR EACH ROW EXECUTE FUNCTION app.touch_settings();
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.is_admin(), app.is_verified(uuid), app.email_allowlisted(text), app.signup_allowed(text),
  app.bootstrap_admin(uuid, text), app.assert_invite_allowed(text), app.remove_user(uuid),
  app.keep_last_admin(), app.touch_settings() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_admin(), app.is_verified(uuid), app.remove_user(uuid) TO kanban_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.signup_allowed(text), app.bootstrap_admin(uuid, text) TO kanban_auth;
--> statement-breakpoint

-- ---------------------------------------------------------------- grants

GRANT SELECT, INSERT, DELETE ON instance_admins TO kanban_app;
--> statement-breakpoint
GRANT SELECT, UPDATE (signup_mode, allowed_domains, allowed_emails, allow_external_invites) ON instance_settings TO kanban_app;
--> statement-breakpoint
GRANT SELECT ON instance_settings TO kanban_auth;
--> statement-breakpoint
-- Admins see whether an account has confirmed its email.
GRANT SELECT (email_verified_at) ON users TO kanban_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- policies

ALTER TABLE instance_admins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE instance_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins see every account; everyone else as before (users_select).
CREATE POLICY users_select_admin ON users FOR SELECT TO kanban_app
  USING (app.is_admin());
--> statement-breakpoint

CREATE POLICY instance_admins_select ON instance_admins FOR SELECT TO kanban_app
  USING (app.is_admin() OR user_id = app.current_user_id());
--> statement-breakpoint
-- Only confirmed accounts are promoted, so nobody gains admin through an
-- address they registered but do not own.
CREATE POLICY instance_admins_insert ON instance_admins FOR INSERT TO kanban_app
  WITH CHECK (app.is_admin() AND app.is_verified(user_id));
--> statement-breakpoint
CREATE POLICY instance_admins_delete ON instance_admins FOR DELETE TO kanban_app
  USING (app.is_admin());
--> statement-breakpoint

CREATE POLICY instance_settings_select ON instance_settings FOR SELECT TO kanban_app
  USING (app.is_admin());
--> statement-breakpoint
CREATE POLICY instance_settings_update ON instance_settings FOR UPDATE TO kanban_app
  USING (app.is_admin()) WITH CHECK (app.is_admin());
--> statement-breakpoint
CREATE POLICY instance_settings_auth ON instance_settings FOR SELECT TO kanban_auth
  USING (true);
