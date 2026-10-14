-- Two-factor authentication, signed-in sessions and the admin audit log.

-- ---------------------------------------------------------------- two-factor

-- Secrets and recovery codes are credentials: kanban_auth only, like
-- password_hash. kanban_app gets no grants, so even a policy bug cannot leak them.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_totp, user_recovery_codes TO kanban_auth;
--> statement-breakpoint
ALTER TABLE user_totp ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_recovery_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_totp_auth ON user_totp FOR ALL TO kanban_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY user_recovery_codes_auth ON user_recovery_codes FOR ALL TO kanban_auth USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------- sessions

-- kanban_auth creates rows at sign-in and revokes them at sign-out.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO kanban_auth;
--> statement-breakpoint
-- Users list their own sessions and revoke them (never un-revoke).
GRANT SELECT, UPDATE (revoked_at) ON user_sessions TO kanban_app;
--> statement-breakpoint
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_sessions_auth ON user_sessions FOR ALL TO kanban_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY user_sessions_select ON user_sessions FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY user_sessions_revoke ON user_sessions FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id() AND revoked_at IS NULL)
  WITH CHECK (user_id = app.current_user_id() AND revoked_at IS NOT NULL);
--> statement-breakpoint

-- Every request (withUser) asks this once: 'ok', 'gone' (no such account) or
-- 'expired' (session version changed, or the session row is missing or
-- revoked). Sessions from before session rows existed carry no id and expire.
-- last_seen_at moves at most every 5 minutes, so most calls only read.
CREATE FUNCTION app.check_session(sid uuid, version integer) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  me uuid := app.current_user_id();
  v integer;
  seen timestamptz;
  revoked timestamptz;
BEGIN
  SELECT session_version INTO v FROM public.users WHERE id = me;
  IF NOT FOUND THEN RETURN 'gone'; END IF;
  IF v IS DISTINCT FROM version THEN RETURN 'expired'; END IF;
  SELECT last_seen_at, revoked_at INTO seen, revoked FROM public.user_sessions WHERE id = sid AND user_id = me;
  IF NOT FOUND OR revoked IS NOT NULL THEN RETURN 'expired'; END IF;
  IF seen < now() - interval '5 minutes' THEN
    UPDATE public.user_sessions SET last_seen_at = now() WHERE id = sid;
  END IF;
  RETURN 'ok';
END
$$;
--> statement-breakpoint

-- A password reset, password change or email change bumps session_version;
-- that signs out every device, so their rows are revoked too.
CREATE FUNCTION app.revoke_sessions_on_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.user_sessions SET revoked_at = now() WHERE user_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER users_revoke_sessions AFTER UPDATE OF session_version ON users
FOR EACH ROW WHEN (OLD.session_version IS DISTINCT FROM NEW.session_version)
EXECUTE FUNCTION app.revoke_sessions_on_version();
--> statement-breakpoint

-- ---------------------------------------------------------------- audit log

GRANT SELECT ON admin_audit_log TO kanban_app;
--> statement-breakpoint
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY admin_audit_log_select ON admin_audit_log FOR SELECT TO kanban_app
  USING (app.is_admin());
--> statement-breakpoint

-- Writes one entry. Actor and target names and emails are copied into data,
-- so the entry survives their deletion. No login role may call it.
CREATE FUNCTION app.log_admin_action(actor uuid, act text, target uuid, extra jsonb DEFAULT '{}') RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.admin_audit_log (actor_id, action, target_user_id, data)
  SELECT actor, act, target, extra || jsonb_strip_nulls(jsonb_build_object(
    'actor_email', a.email, 'actor_name', a.name, 'target_email', t.email, 'target_name', t.name))
  FROM (SELECT 1) one
  LEFT JOIN public.users a ON a.id = actor
  LEFT JOIN public.users t ON t.id = target
$$;
--> statement-breakpoint

-- Promotions, demotions and the NUXT_ADMIN_EMAIL bootstrap (app.bootstrap_admin
-- runs as kanban_auth with no current user; the admin is their own actor).
-- Demotions caused by deleting the account are logged by the removal itself.
CREATE FUNCTION app.audit_instance_admins() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app.current_user_id() IS NULL THEN
      PERFORM app.log_admin_action(NEW.user_id, 'admin.bootstrap', NEW.user_id);
    ELSE
      PERFORM app.log_admin_action(app.current_user_id(), 'admin.promote', NEW.user_id);
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
    PERFORM app.log_admin_action(app.current_user_id(), 'admin.demote', OLD.user_id);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER instance_admins_audit AFTER INSERT OR DELETE ON instance_admins
FOR EACH ROW EXECUTE FUNCTION app.audit_instance_admins();
--> statement-breakpoint

-- Settings changes, as { changes: { field: { from, to } } } for changed fields only.
CREATE FUNCTION app.audit_instance_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  changes jsonb;
BEGIN
  SELECT jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)) INTO changes
  FROM jsonb_each(to_jsonb(NEW) - 'updated_at') n
  JOIN jsonb_each(to_jsonb(OLD) - 'updated_at') o USING (key)
  WHERE n.value IS DISTINCT FROM o.value;
  IF changes IS NOT NULL THEN
    PERFORM app.log_admin_action(app.current_user_id(), 'settings.update', NULL, jsonb_build_object('changes', changes));
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER instance_settings_audit AFTER UPDATE ON instance_settings
FOR EACH ROW EXECUTE FUNCTION app.audit_instance_settings();
--> statement-breakpoint

-- As in 0024, plus the audit entry (written before the user row goes, so it
-- has the name and email).
CREATE OR REPLACE FUNCTION app.remove_user(u uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT app.is_admin() OR u = app.current_user_id() THEN
    RAISE EXCEPTION 'only admins can remove other users' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = u) THEN
    PERFORM app.log_admin_action(app.current_user_id(), 'user.remove', u);
  END IF;
  PERFORM app.remove_user_internal(u);
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.delete_my_account() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  me uuid := app.current_user_id();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.instance_admins WHERE user_id = me)
     AND NOT EXISTS (SELECT 1 FROM public.instance_admins WHERE user_id <> me) THEN
    RAISE EXCEPTION 'there must be at least one admin left' USING ERRCODE = 'KB002';
  END IF;
  PERFORM app.log_admin_action(me, 'user.delete_self', me);
  PERFORM app.remove_user_internal(me);
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.check_session(uuid, integer), app.revoke_sessions_on_version(),
  app.log_admin_action(uuid, text, uuid, jsonb), app.audit_instance_admins(), app.audit_instance_settings() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.check_session(uuid, integer) TO kanban_app, kanban_auth;
