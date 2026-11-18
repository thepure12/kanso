-- Commenter role (0091): between editor and viewer. Reads like a viewer
-- (access capped at read), and on cards they can see also comments (adds,
-- edits and deletes their own), logs time (their own entries), watches and
-- reacts. No other card or board changes. drizzle-kit runs pending migrations
-- in one transaction, so the new enum value is compared as text here.

-- Access cap: commenters read at most, like viewers.
CREATE OR REPLACE FUNCTION app.user_access(b uuid, u uuid, col uuid, card uuid)
RETURNS public.board_access
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH r AS (SELECT app.user_board_role(b, u) AS role)
  SELECT CASE
    WHEN r.role IS NULL THEN 'none'::public.board_access
    WHEN r.role::text IN ('viewer', 'commenter') AND l.user_id IS NULL THEN 'read'::public.board_access
    WHEN r.role = 'owner' OR l.user_id IS NULL THEN 'edit'::public.board_access
    ELSE least(
      coalesce(
        (SELECT a.access FROM public.board_member_access a WHERE a.board_id = b AND a.user_id = u AND a.card_id = card),
        (SELECT a.access FROM public.board_member_access a WHERE a.board_id = b AND a.user_id = u AND a.column_id = col),
        l.default_access),
      CASE WHEN r.role::text IN ('viewer', 'commenter') THEN 'read' ELSE 'edit' END::public.board_access)
  END
  FROM r LEFT JOIN public.board_member_limits l ON l.board_id = b AND l.user_id = u
$$;
--> statement-breakpoint

-- Comments and time entries: whoever may edit the card, and commenters on
-- cards they can see, on an unarchived board.
CREATE FUNCTION app.can_comment_card(card uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((
    SELECT NOT app.board_archived(c.board_id) AND CASE app.my_access(c.board_id, c.column_id, c.id)
      WHEN 'edit' THEN true
      WHEN 'read' THEN app.board_role(c.board_id)::text = 'commenter'
      ELSE false END
    FROM public.cards c WHERE c.id = card), false)
$$;
--> statement-breakpoint

ALTER POLICY card_comments_insert ON card_comments
  WITH CHECK (app.can_comment_card(card_id) AND (author_id = app.current_user_id()
    OR (author_id IS NULL AND imported_author IS NOT NULL
      AND EXISTS (SELECT 1 FROM boards b WHERE b.id = card_comments.board_id AND b.created_at = now()))));
--> statement-breakpoint
ALTER POLICY card_comments_update ON card_comments
  USING (author_id = app.current_user_id() AND app.can_comment_card(card_id))
  WITH CHECK (author_id = app.current_user_id() AND app.can_comment_card(card_id));
--> statement-breakpoint
ALTER POLICY card_comments_delete ON card_comments
  USING ((app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id))
    OR (author_id = app.current_user_id() AND app.can_comment_card(card_id)));
--> statement-breakpoint
ALTER POLICY time_entries_insert ON time_entries
  WITH CHECK (app.can_comment_card(card_id) AND user_id = app.current_user_id());
--> statement-breakpoint
ALTER POLICY time_entries_update ON time_entries
  USING (user_id = app.current_user_id() AND app.can_comment_card(card_id))
  WITH CHECK (user_id = app.current_user_id() AND app.can_comment_card(card_id));
--> statement-breakpoint
ALTER POLICY time_entries_delete ON time_entries
  USING ((app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id))
    OR (user_id = app.current_user_id() AND app.can_comment_card(card_id)));
--> statement-breakpoint

-- Owners may limit commenters too.
ALTER POLICY board_member_limits_insert ON board_member_limits
  WITH CHECK (app.board_role(board_id) = 'owner'
    AND app.user_board_role(board_id, user_id)::text IN ('editor', 'commenter', 'viewer'));
--> statement-breakpoint
ALTER POLICY board_member_limits_update ON board_member_limits
  USING (app.board_role(board_id) = 'owner')
  WITH CHECK (app.board_role(board_id) = 'owner'
    AND app.user_board_role(board_id, user_id)::text IN ('editor', 'commenter', 'viewer'));
