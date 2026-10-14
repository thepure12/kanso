-- Starred boards and board archive.

-- ---------------------------------------------------------------- stars

-- Personal: people star and unstar boards they can see, and only see their own
-- stars (rows for boards they lost access to stay hidden). No notify trigger:
-- nobody else's board view changes.
GRANT SELECT, INSERT, DELETE ON board_stars TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_stars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_stars_select ON board_stars FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_stars_insert ON board_stars FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_stars_delete ON board_stars FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint

-- ---------------------------------------------------------------- archive

CREATE FUNCTION app.board_archived(b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT coalesce((SELECT archived_at IS NOT NULL FROM public.boards WHERE id = b), false) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.board_archived(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.board_archived(uuid) TO kanban_app;
--> statement-breakpoint

-- Archived boards are read-only for everyone, owners included: every content
-- write policy (columns, cards, tags, rules, fields, checklist, comments,
-- attachments, time, links...) goes through app.can_edit. Membership, invites,
-- personal stars and watches, and deleting the board stay possible.
CREATE OR REPLACE FUNCTION app.can_edit(b uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app.board_role(b) IN ('owner', 'editor'), false) AND NOT app.board_archived(b) $$;
--> statement-breakpoint

-- The two policies that let owners delete other people's rows bypass can_edit.
DROP POLICY card_comments_delete ON card_comments;
--> statement-breakpoint
CREATE POLICY card_comments_delete ON card_comments FOR DELETE TO kanban_app
  USING (
    (app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id))
    OR (author_id = app.current_user_id() AND app.can_edit(board_id))
  );
--> statement-breakpoint
DROP POLICY time_entries_delete ON time_entries;
--> statement-breakpoint
CREATE POLICY time_entries_delete ON time_entries FOR DELETE TO kanban_app
  USING (
    (app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id))
    OR (user_id = app.current_user_id() AND app.can_edit(board_id))
  );
--> statement-breakpoint

-- No renaming while archived. archived_at has no UPDATE grant: it changes only
-- through app.set_board_archived.
DROP POLICY boards_update ON boards;
--> statement-breakpoint
CREATE POLICY boards_update ON boards FOR UPDATE TO kanban_app
  USING (app.board_role(id) = 'owner' AND archived_at IS NULL)
  WITH CHECK (app.board_role(id) = 'owner' AND archived_at IS NULL);
--> statement-breakpoint

-- Owners (effective role, so team owners too) archive and unarchive.
CREATE FUNCTION app.set_board_archived(b uuid, archived boolean) RETURNS public.boards
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.boards;
BEGIN
  IF app.board_role(b) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only board owners can archive a board' USING ERRCODE = '42501';
  END IF;
  UPDATE public.boards
  SET archived_at = CASE WHEN archived THEN coalesce(archived_at, now()) END
  WHERE id = b
  RETURNING * INTO r;
  RETURN r;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.set_board_archived(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.set_board_archived(uuid, boolean) TO kanban_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- notifications

-- Archived boards notify nobody (as copies made in the same transaction).
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO mentioned
  FROM jsonb_array_elements_text(coalesce(NEW.data -> 'mentions', '[]')) x;

  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT r.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM (
    SELECT p.user_id FROM (
      SELECT ca.user_id FROM public.card_assignees ca WHERE ca.card_id = NEW.card_id
      UNION
      SELECT w.user_id FROM public.card_watchers w WHERE w.card_id = NEW.card_id
    ) p
    WHERE NEW.kind <> 'mentioned'
      AND (NEW.kind <> 'assigned' OR p.user_id = (NEW.data ->> 'user_id')::uuid)
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

-- The digest leaves out archived boards (unread items and due cards).
CREATE OR REPLACE FUNCTION app.claim_digests()
RETURNS TABLE (user_id uuid, email text, name text, items jsonb, due jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
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
        AND b.archived_at IS NULL
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
    WHERE ca.user_id = c.id AND k.archived_at IS NULL AND b.archived_at IS NULL AND k.due_date <= current_date + 1
      AND app.is_member(k.board_id, c.id)
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
