-- Per-member access limits (0087).
--   board_member_limits (board, user, default_access)   a row = the non-owner is limited on the board
--   board_member_access (board, user, column | card, access)   per-column and per-card overrides
-- Access to a card = its card entry, else its column's entry, else default_access,
-- capped by the role (viewer: at most read). Owners are never limited. Limited people:
--   * see only cards (and their checklist, comments, attachments, activity, links,
--     time, fields, tags, assignees, watchers, notifications, ...) with access read/edit,
--     and only columns with access read/edit or holding such a card;
--   * change only cards with access edit, create cards only in columns with access
--     edit, and move cards only into columns with access edit;
--   * cannot change the board's structure (columns, tags, fields, rules, column groups,
--     automations, recurrences, shared views, trash): app.can_edit is false for them.
-- Select policies use set-returning helpers (evaluated once per query, as
-- app.visible_user_ids); write policies call per-row helpers.

-- ---------------------------------------------------------------- helpers

-- Effective access of user u to a card (card may be null: a new card in col).
CREATE FUNCTION app.user_access(b uuid, u uuid, col uuid, card uuid)
RETURNS public.board_access
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH r AS (SELECT app.user_board_role(b, u) AS role)
  SELECT CASE
    WHEN r.role IS NULL THEN 'none'::public.board_access
    WHEN r.role = 'viewer' AND l.user_id IS NULL THEN 'read'::public.board_access
    WHEN r.role = 'owner' OR l.user_id IS NULL THEN 'edit'::public.board_access
    ELSE least(
      coalesce(
        (SELECT a.access FROM public.board_member_access a WHERE a.board_id = b AND a.user_id = u AND a.card_id = card),
        (SELECT a.access FROM public.board_member_access a WHERE a.board_id = b AND a.user_id = u AND a.column_id = col),
        l.default_access),
      CASE WHEN r.role = 'viewer' THEN 'read' ELSE 'edit' END::public.board_access)
  END
  FROM r LEFT JOIN public.board_member_limits l ON l.board_id = b AND l.user_id = u
$$;
--> statement-breakpoint
CREATE FUNCTION app.user_card_access(u uuid, card uuid)
RETURNS public.board_access
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((SELECT app.user_access(c.board_id, u, c.column_id, c.id) FROM public.cards c WHERE c.id = card),
                  'none'::public.board_access)
$$;
--> statement-breakpoint
-- The caller's access (follows a board-limited API token like app.board_role).
CREATE FUNCTION app.my_access(b uuid, col uuid, card uuid)
RETURNS public.board_access
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN app.token_allows(b) THEN app.user_access(b, app.current_user_id(), col, card)
              ELSE 'none'::public.board_access END
$$;
--> statement-breakpoint
-- Card writes: access edit on an unarchived board.
CREATE FUNCTION app.can_edit_in(b uuid, col uuid, card uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT app.my_access(b, col, card) = 'edit' AND NOT app.board_archived(b) $$;
--> statement-breakpoint
CREATE FUNCTION app.can_edit_card(card uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((SELECT app.can_edit_in(c.board_id, c.column_id, c.id) FROM public.cards c WHERE c.id = card), false)
$$;
--> statement-breakpoint
CREATE FUNCTION app.can_see_card(card uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((SELECT app.my_access(c.board_id, c.column_id, c.id) <> 'none' FROM public.cards c WHERE c.id = card), false)
$$;
--> statement-breakpoint
-- True when the caller is limited on the board (owners never are).
CREATE FUNCTION app.is_limited(b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.board_member_limits l
                 WHERE l.board_id = b AND l.user_id = app.current_user_id())
     AND app.user_board_role(b, app.current_user_id()) IS DISTINCT FROM 'owner'
$$;
--> statement-breakpoint
-- Boards the caller is limited on.
CREATE FUNCTION app.limited_board_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT l.board_id FROM public.board_member_limits l
  WHERE l.user_id = app.current_user_id()
    AND app.user_board_role(l.board_id, l.user_id) IS DISTINCT FROM 'owner'
$$;
--> statement-breakpoint
-- Cards (trashed and templates included) the caller may see on those boards.
CREATE FUNCTION app.limited_card_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT c.id
  FROM public.board_member_limits l
  JOIN public.cards c ON c.board_id = l.board_id
  LEFT JOIN public.board_member_access ka ON ka.board_id = l.board_id AND ka.user_id = l.user_id AND ka.card_id = c.id
  LEFT JOIN public.board_member_access co ON co.board_id = l.board_id AND co.user_id = l.user_id AND co.column_id = c.column_id
  WHERE l.user_id = app.current_user_id()
    AND app.user_board_role(l.board_id, l.user_id) IS DISTINCT FROM 'owner'
    AND coalesce(ka.access, co.access, l.default_access) <> 'none'
$$;
--> statement-breakpoint
-- Columns the caller may see on those boards: access read/edit, or holding a visible card.
CREATE FUNCTION app.limited_column_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT k.id
  FROM public.board_member_limits l
  JOIN public.columns k ON k.board_id = l.board_id
  LEFT JOIN public.board_member_access co ON co.board_id = l.board_id AND co.user_id = l.user_id AND co.column_id = k.id
  WHERE l.user_id = app.current_user_id()
    AND app.user_board_role(l.board_id, l.user_id) IS DISTINCT FROM 'owner'
    AND coalesce(co.access, l.default_access) <> 'none'
  UNION
  SELECT c.column_id FROM public.cards c
  WHERE c.deleted_at IS NULL AND c.id IN (SELECT app.limited_card_ids())
$$;
--> statement-breakpoint
-- Structure edits: limited people get none.
CREATE OR REPLACE FUNCTION app.can_edit(b uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app.board_role(b) IN ('owner', 'editor'), false) AND NOT app.board_archived(b) AND NOT app.is_limited(b) $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- limit tables

GRANT SELECT, INSERT, DELETE ON board_member_limits TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (default_access) ON board_member_limits TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON board_member_access TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_member_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE board_member_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Owners see and manage everyone's limits; a limited person reads their own.
CREATE POLICY board_member_limits_select ON board_member_limits FOR SELECT TO kanban_app
  USING (app.board_role(board_id) = 'owner' OR (user_id = app.current_user_id() AND app.token_allows(board_id)));
--> statement-breakpoint
CREATE POLICY board_member_limits_insert ON board_member_limits FOR INSERT TO kanban_app
  WITH CHECK (app.board_role(board_id) = 'owner' AND app.user_board_role(board_id, user_id) IN ('editor', 'viewer'));
--> statement-breakpoint
CREATE POLICY board_member_limits_update ON board_member_limits FOR UPDATE TO kanban_app
  USING (app.board_role(board_id) = 'owner')
  WITH CHECK (app.board_role(board_id) = 'owner' AND app.user_board_role(board_id, user_id) IN ('editor', 'viewer'));
--> statement-breakpoint
CREATE POLICY board_member_limits_delete ON board_member_limits FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY board_member_access_select ON board_member_access FOR SELECT TO kanban_app
  USING (app.board_role(board_id) = 'owner' OR (user_id = app.current_user_id() AND app.token_allows(board_id)));
--> statement-breakpoint
CREATE POLICY board_member_access_insert ON board_member_access FOR INSERT TO kanban_app
  WITH CHECK (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY board_member_access_delete ON board_member_access FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE TRIGGER board_member_limits_notify AFTER INSERT OR UPDATE OR DELETE ON board_member_limits
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
CREATE TRIGGER board_member_access_notify AFTER INSERT OR DELETE ON board_member_access
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
--> statement-breakpoint
-- Leaving the board drops the limits, so being added again starts unlimited.
CREATE FUNCTION app.drop_member_limits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.board_member_limits
  WHERE board_id = OLD.board_id AND user_id = OLD.user_id
    AND app.user_board_role(OLD.board_id, OLD.user_id) IS NULL;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER board_members_drop_limits AFTER DELETE ON board_members
FOR EACH ROW EXECUTE FUNCTION app.drop_member_limits();
--> statement-breakpoint

-- ---------------------------------------------------------------- cards and columns

ALTER POLICY cards_select ON cards
  USING (deleted_at IS NULL AND app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY cards_insert ON cards
  WITH CHECK (app.can_edit_in(board_id, column_id, NULL) AND created_by = app.current_user_id()
    AND deleted_at IS NULL AND deleted_by IS NULL);
--> statement-breakpoint
ALTER POLICY cards_update ON cards
  USING (app.can_edit_in(board_id, column_id, id))
  WITH CHECK (app.can_edit_in(board_id, column_id, id) AND deleted_at IS NULL AND deleted_by IS NULL);
--> statement-breakpoint
-- A limited person moves cards only into columns they may edit (a card entry
-- with edit does not widen that). Automations run without a user: untouched.
CREATE FUNCTION app.check_limited_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.column_id IS DISTINCT FROM OLD.column_id AND app.current_user_id() IS NOT NULL
     AND app.is_limited(NEW.board_id)
     AND app.my_access(NEW.board_id, NEW.column_id, NULL) <> 'edit' THEN
    RAISE EXCEPTION 'cannot move the card into that column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cards_check_limited_move BEFORE UPDATE OF column_id ON cards
FOR EACH ROW EXECUTE FUNCTION app.check_limited_move();
--> statement-breakpoint
ALTER POLICY columns_select ON columns
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR id IN (SELECT app.limited_column_ids())));
--> statement-breakpoint
ALTER POLICY column_rules_select ON column_rules
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR column_id IN (SELECT app.limited_column_ids())));
--> statement-breakpoint
ALTER POLICY column_group_members_select ON column_group_members
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR column_id IN (SELECT app.limited_column_ids())));
--> statement-breakpoint
ALTER POLICY board_automations_select ON board_automations
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR (
      (card_id IS NULL OR card_id IN (SELECT app.limited_card_ids()))
      AND (column_id IS NULL OR column_id IN (SELECT app.limited_column_ids()))
      AND (target_column_id IS NULL OR target_column_id IN (SELECT app.limited_column_ids())))));
--> statement-breakpoint
ALTER POLICY card_recurrences_select ON card_recurrences
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR template_card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint

-- ---------------------------------------------------------------- card children: reads

ALTER POLICY card_activity_select ON card_activity
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_assignees_select ON card_assignees
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_attachments_select ON card_attachments
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_comments_select ON card_comments
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_field_values_select ON card_field_values
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_links_select ON card_links
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids())
      OR (from_card_id IN (SELECT app.limited_card_ids()) AND to_card_id IN (SELECT app.limited_card_ids()))));
--> statement-breakpoint
ALTER POLICY card_matrix_threads_select ON card_matrix_threads
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_scheduled_actions_select ON card_scheduled_actions
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_tags_select ON card_tags
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY card_watchers_select ON card_watchers
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY checklist_items_select ON checklist_items
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY time_entries_select ON time_entries
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint
ALTER POLICY comment_reactions_select ON comment_reactions
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids())
      OR comment_id IN (SELECT c.id FROM public.card_comments c WHERE c.card_id IN (SELECT app.limited_card_ids()))));
--> statement-breakpoint
ALTER POLICY notifications_select ON notifications
  USING (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR card_id IN (SELECT app.limited_card_ids())));
--> statement-breakpoint

-- ---------------------------------------------------------------- card children: writes

ALTER POLICY card_assignees_insert ON card_assignees
  WITH CHECK (app.can_edit_card(card_id) AND app.is_member(board_id, user_id));
--> statement-breakpoint
ALTER POLICY card_assignees_delete ON card_assignees USING (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_attachments_insert ON card_attachments
  WITH CHECK (app.can_edit_card(card_id) AND uploaded_by = app.current_user_id());
--> statement-breakpoint
ALTER POLICY card_attachments_delete ON card_attachments USING (app.can_edit_card(card_id));
--> statement-breakpoint
-- Imported comments (null author) only come with a board made in the same
-- transaction, where the importer is the owner and so never limited.
ALTER POLICY card_comments_insert ON card_comments
  WITH CHECK (app.can_edit_card(card_id) AND (author_id = app.current_user_id()
    OR (author_id IS NULL AND imported_author IS NOT NULL
      AND EXISTS (SELECT 1 FROM boards b WHERE b.id = card_comments.board_id AND b.created_at = now()))));
--> statement-breakpoint
ALTER POLICY card_comments_update ON card_comments
  USING (author_id = app.current_user_id() AND app.can_edit_card(card_id))
  WITH CHECK (author_id = app.current_user_id() AND app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_comments_delete ON card_comments
  USING ((app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id))
    OR (author_id = app.current_user_id() AND app.can_edit_card(card_id)));
--> statement-breakpoint
ALTER POLICY card_field_values_insert ON card_field_values WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_field_values_update ON card_field_values
  USING (app.can_edit_card(card_id)) WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_field_values_delete ON card_field_values USING (app.can_edit_card(card_id));
--> statement-breakpoint
-- Links: edit the card it starts from, see the other one.
ALTER POLICY card_links_insert ON card_links
  WITH CHECK (app.can_edit_card(from_card_id) AND app.can_see_card(to_card_id) AND created_by = app.current_user_id());
--> statement-breakpoint
ALTER POLICY card_links_delete ON card_links
  USING (app.can_edit_card(from_card_id) OR app.can_edit_card(to_card_id));
--> statement-breakpoint
ALTER POLICY card_matrix_threads_insert ON card_matrix_threads
  WITH CHECK (app.can_edit_card(card_id) AND created_by = app.current_user_id());
--> statement-breakpoint
ALTER POLICY card_matrix_threads_update ON card_matrix_threads
  USING (app.can_edit_card(card_id)) WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_matrix_threads_delete ON card_matrix_threads USING (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_scheduled_actions_insert ON card_scheduled_actions
  WITH CHECK (app.can_edit_card(card_id) AND created_by = app.current_user_id()
    AND EXISTS (SELECT 1 FROM cards c WHERE c.id = card_id AND NOT c.is_template));
--> statement-breakpoint
ALTER POLICY card_scheduled_actions_delete ON card_scheduled_actions USING (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_tags_insert ON card_tags WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_tags_delete ON card_tags USING (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY card_watchers_insert ON card_watchers
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL AND app.can_see_card(card_id));
--> statement-breakpoint
ALTER POLICY checklist_items_insert ON checklist_items WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY checklist_items_update ON checklist_items
  USING (app.can_edit_card(card_id)) WITH CHECK (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY checklist_items_delete ON checklist_items USING (app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY time_entries_insert ON time_entries
  WITH CHECK (app.can_edit_card(card_id) AND user_id = app.current_user_id());
--> statement-breakpoint
ALTER POLICY time_entries_update ON time_entries
  USING (user_id = app.current_user_id() AND app.can_edit_card(card_id))
  WITH CHECK (user_id = app.current_user_id() AND app.can_edit_card(card_id));
--> statement-breakpoint
ALTER POLICY time_entries_delete ON time_entries
  USING ((app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id))
    OR (user_id = app.current_user_id() AND app.can_edit_card(card_id)));
--> statement-breakpoint
ALTER POLICY comment_reactions_insert ON comment_reactions
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL
    AND NOT app.board_archived(board_id)
    AND EXISTS (SELECT 1 FROM public.card_comments c WHERE c.id = comment_id AND app.can_see_card(c.card_id)));
--> statement-breakpoint

-- ---------------------------------------------------------------- functions

-- Trash and restore: the card's own access (so a limited editor can delete and
-- undo); the trash list and purging stay with app.can_edit.
CREATE OR REPLACE FUNCTION app.trash_card(card uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH t AS (
    UPDATE public.cards SET deleted_at = now(), deleted_by = app.current_user_id()
    WHERE id = card AND deleted_at IS NULL AND app.can_edit_in(board_id, column_id, id)
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM t)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.restore_card(card uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH t AS (
    UPDATE public.cards SET deleted_at = NULL, deleted_by = NULL
    WHERE id = card AND deleted_at IS NOT NULL AND app.can_edit_in(board_id, column_id, id)
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM t)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.matrix_thread_reply_target(c uuid)
RETURNS TABLE(homeserver_url text, room_id text, event_id text, access_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT m.homeserver_url, t.room_id, t.event_id, m.access_token
  FROM public.card_matrix_threads t
  JOIN public.board_matrix_rooms m ON m.board_id = t.board_id
  JOIN public.cards k ON k.id = t.card_id
  WHERE t.card_id = c AND t.event_id <> '' AND k.deleted_at IS NULL
    AND app.can_edit_in(k.board_id, k.column_id, k.id)
$$;
--> statement-breakpoint
-- Notifications: only people who may see the card.
CREATE OR REPLACE FUNCTION app.fan_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  mentioned uuid[];
BEGIN
  IF NEW.kind NOT IN ('assigned', 'commented', 'mentioned', 'moved', 'due', 'archived', 'stale', 'reminder')
     OR EXISTS (SELECT 1 FROM public.boards WHERE id = NEW.board_id AND (created_at = now() OR archived_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO mentioned
  FROM jsonb_array_elements_text(coalesce(NEW.data -> 'mentions', '[]')) x;

  INSERT INTO public.notifications (user_id, card_id, board_id, activity_id, created_at)
  SELECT r.user_id, NEW.card_id, NEW.board_id, NEW.id, NEW.created_at
  FROM (
    SELECT p.user_id, bool_or(p.src = 'assignee') AS assignee, bool_or(p.src = 'mention') AS mention
    FROM (
      SELECT ca.user_id, 'assignee' AS src FROM public.card_assignees ca
      WHERE ca.card_id = NEW.card_id AND NEW.kind <> 'mentioned'
        AND (NEW.kind <> 'assigned' OR ca.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT w.user_id, 'watcher' FROM public.card_watchers w
      WHERE w.card_id = NEW.card_id AND NEW.kind <> 'mentioned'
        AND (NEW.kind <> 'assigned' OR w.user_id = (NEW.data ->> 'user_id')::uuid)
      UNION ALL
      SELECT unnest(mentioned), 'mention'
    ) p
    GROUP BY p.user_id
  ) r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.board_notification_settings s ON s.board_id = NEW.board_id AND s.user_id = r.user_id
  WHERE r.user_id IS DISTINCT FROM NEW.actor_id
    AND app.is_member(NEW.board_id, r.user_id)
    AND app.user_card_access(r.user_id, NEW.card_id) <> 'none'
    -- Only watching: the user may have turned watched cards off.
    AND (r.assignee OR r.mention OR NEW.kind = 'assigned' OR u.notify_watching)
    AND (s.level IS NULL OR (s.level = 'direct' AND (r.mention OR NEW.kind = 'assigned')))
    AND app.notify_on(u.notification_prefs, app.notification_event(NEW.kind::text, NEW.data, r.user_id), 'inbox');
  PERFORM pg_notify('user_notifications', json_build_object('u', user_id)::text)
  FROM public.notifications WHERE activity_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Digest: items and due cards only for cards the recipient may see.
CREATE OR REPLACE FUNCTION app.claim_digests()
RETURNS TABLE(user_id uuid, email text, name text, locale text, items jsonb, due jsonb)
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
    RETURNING u.id, u.email::text AS email, u.name, u.locale, u.notification_prefs AS prefs, p.prev
  )
  SELECT c.id, c.email, c.name, c.locale, i.items, d.due
  FROM claimed c
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'createdAt' DESC), '[]') AS items FROM (
      SELECT jsonb_build_object(
        'boardId', n.board_id, 'boardName', b.name, 'cardId', n.card_id, 'cardTitle', k.title,
        'actorName', au.name, 'kind', a.kind, 'data', a.data, 'createdAt', a.created_at) AS x
      FROM public.notifications n
      JOIN public.card_activity a ON a.id = n.activity_id
      JOIN public.cards k ON k.id = n.card_id AND k.deleted_at IS NULL
      JOIN public.boards b ON b.id = n.board_id
      LEFT JOIN public.users au ON au.id = a.actor_id
      WHERE n.user_id = c.id AND n.read_at IS NULL
        AND n.created_at > coalesce(c.prev, '-infinity')
        AND b.archived_at IS NULL
        AND app.is_member(n.board_id, c.id)
        AND app.user_access(k.board_id, c.id, k.column_id, k.id) <> 'none'
        AND app.notify_on(c.prefs, app.notification_event(a.kind::text, a.data, c.id), 'email')
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
    WHERE ca.user_id = c.id AND k.archived_at IS NULL AND k.deleted_at IS NULL AND NOT k.is_template AND b.archived_at IS NULL
      AND k.due_date <= current_date + 1
      AND app.is_member(k.board_id, c.id)
      AND app.user_access(k.board_id, c.id, k.column_id, k.id) <> 'none'
  ) d
  WHERE i.items <> '[]' OR d.due <> '[]'
$$;
