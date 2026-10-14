-- Account settings, @mentions and the email digest.

-- ---------------------------------------------------------------- account

-- withUser compares the session's version; the digest toggle is self-service.
GRANT SELECT (session_version, digest_enabled), UPDATE (digest_enabled) ON users TO kanban_app;
--> statement-breakpoint

-- The body of app.remove_user, shared with app.delete_my_account. Not
-- executable by any login role: callers go through one of the two checks.
CREATE FUNCTION app.remove_user_internal(u uuid) RETURNS void
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

CREATE OR REPLACE FUNCTION app.remove_user(u uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT app.is_admin() OR u = app.current_user_id() THEN
    RAISE EXCEPTION 'only admins can remove other users' USING ERRCODE = '42501';
  END IF;
  PERFORM app.remove_user_internal(u);
END
$$;
--> statement-breakpoint

-- Users delete their own account. The last admin cannot (keep_last_admin is
-- skipped when the user row itself goes, so it is checked here).
CREATE FUNCTION app.delete_my_account() RETURNS void
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
  PERFORM app.remove_user_internal(me);
END
$$;
--> statement-breakpoint

-- A verified account that changes its email claims invites sent to the new one.
CREATE TRIGGER users_claim_invites_on_email AFTER UPDATE OF email ON users
FOR EACH ROW WHEN (NEW.email_verified_at IS NOT NULL AND OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION app.claim_invites();
--> statement-breakpoint

-- ---------------------------------------------------------------- mentions

-- User ids mentioned in a comment body as @[Name](user:<uuid>).
CREATE FUNCTION app.comment_mentions(body text) RETURNS uuid[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT coalesce(array_agg(DISTINCT m[1]::uuid), '{}')
  FROM regexp_matches(body, '@\[[^\]]*\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)', 'gi') AS m
$$;
--> statement-breakpoint

-- New comments log 'commented' with the mentioned ids; edits log 'mentioned'
-- for people who were not mentioned before.
CREATE OR REPLACE FUNCTION app.log_card_comment_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  added uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.log_activity(NEW.card_id, NEW.board_id, 'commented',
      jsonb_build_object('mentions', to_jsonb(app.comment_mentions(NEW.body))));
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x), '{}') INTO added
  FROM unnest(app.comment_mentions(NEW.body)) x
  WHERE x <> ALL (app.comment_mentions(OLD.body));
  IF cardinality(added) > 0 THEN
    PERFORM app.log_activity(NEW.card_id, NEW.board_id, 'mentioned', jsonb_build_object('mentions', to_jsonb(added)));
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER card_comments_log_mentions
AFTER UPDATE OF body ON card_comments
FOR EACH ROW EXECUTE FUNCTION app.log_card_comment_activity();
--> statement-breakpoint

-- As in 0016, plus mentions: 'commented' reaches assignees and mentioned
-- people, 'mentioned' only the mentioned. Recipients still need board access,
-- so mentioning an outsider does nothing.
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND created_at = now()) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO mentioned
  FROM jsonb_array_elements_text(coalesce(NEW.data -> 'mentions', '[]')) x;

  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT r.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM (
    SELECT ca.user_id FROM public.card_assignees ca
    WHERE ca.card_id = NEW.card_id AND NEW.kind <> 'mentioned'
      AND (NEW.kind <> 'assigned' OR ca.user_id = (NEW.data ->> 'user_id')::uuid)
    UNION
    SELECT unnest(mentioned)
  ) r
  WHERE r.user_id IS DISTINCT FROM NEW.actor_id
    AND app.is_member(NEW.board_id, r.user_id);
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- digest

-- Claims today's digests: marks every opted-in, verified user not yet sent one
-- today and returns, for those with something to report, their unread
-- notifications since the previous digest and their cards due by tomorrow.
-- Claiming and reading happen in one statement, so two app instances never
-- send the same digest. Only kanban_auth (the scheduled task) may call it.
CREATE FUNCTION app.claim_digests()
RETURNS TABLE (user_id uuid, email text, name text, items jsonb, due jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH pending AS (
    SELECT u.id, u.digest_sent_at AS prev FROM public.users u
    WHERE u.digest_enabled AND u.email_verified_at IS NOT NULL
      AND (u.digest_sent_at IS NULL OR u.digest_sent_at < date_trunc('day', now()))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.users u SET digest_sent_at = now()
    FROM pending p WHERE u.id = p.id
    RETURNING u.id, u.email::text AS email, u.name, p.prev
  )
  SELECT c.id, c.email, c.name, i.items, d.due
  FROM claimed c
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'createdAt' DESC), '[]') AS items FROM (
      SELECT jsonb_build_object(
        'boardId', n.board_id, 'boardName', b.name, 'cardId', n.card_id, 'cardTitle', k.title,
        'actorName', au.name, 'kind', a.kind, 'data', a.data, 'createdAt', a.created_at) AS x
      FROM public.notifications n
      JOIN public.card_activity a ON a.id = n.activity_id
      JOIN public.cards k ON k.id = n.card_id
      JOIN public.boards b ON b.id = n.board_id
      LEFT JOIN public.users au ON au.id = a.actor_id
      WHERE n.user_id = c.id AND n.read_at IS NULL
        AND n.created_at > coalesce(c.prev, '-infinity')
        AND app.is_member(n.board_id, c.id)
      ORDER BY n.created_at DESC LIMIT 50
    ) s
  ) i
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'boardId', k.board_id, 'boardName', b.name, 'cardId', k.id, 'cardTitle', k.title, 'dueDate', k.due_date)
      ORDER BY k.due_date), '[]') AS due
    FROM public.card_assignees ca
    JOIN public.cards k ON k.id = ca.card_id
    JOIN public.boards b ON b.id = k.board_id
    WHERE ca.user_id = c.id AND k.archived_at IS NULL AND k.due_date <= current_date + 1
      AND app.is_member(k.board_id, c.id)
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.remove_user_internal(uuid), app.delete_my_account(), app.comment_mentions(text),
  app.claim_digests() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.delete_my_account() TO kanban_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_digests() TO kanban_auth;
