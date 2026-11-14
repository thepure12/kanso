-- A board member's Matrix account on that board. Anyone on the board starts a
-- link for themselves (the database picks the code, so nobody can choose a code
-- someone else already posted); the server confirms it through
-- app.confirm_matrix_user once the bot found the code in the board's room,
-- sent by that Matrix ID. People read their own row and the board's verified
-- links (codes are cleared on verification); they delete only their own.
GRANT SELECT ON board_matrix_users TO kanban_app;
--> statement-breakpoint
GRANT INSERT (board_id, user_id, mxid) ON board_matrix_users TO kanban_app;
--> statement-breakpoint
GRANT DELETE ON board_matrix_users TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_matrix_users ADD CONSTRAINT board_matrix_users_mxid_shape
  CHECK (mxid ~ '^@[^:[:space:]]+:[^[:space:]]+$' AND length(mxid) <= 255);
--> statement-breakpoint
ALTER TABLE board_matrix_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_matrix_users_select ON board_matrix_users FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL AND (user_id = app.current_user_id() OR verified_at IS NOT NULL));
--> statement-breakpoint
CREATE POLICY board_matrix_users_insert ON board_matrix_users FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_matrix_users_delete ON board_matrix_users FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint

-- Marks the caller's pending link on board b verified when `c` is its unexpired
-- code, and clears the code. Another person's link to the same Matrix ID on
-- the board is dropped: the code proves who holds the account now. Called by
-- the server only after the bot found the code in the room from that Matrix
-- ID (like email tokens, the proof is checked by the server). False when there
-- is no such pending link.
CREATE FUNCTION app.confirm_matrix_user(b uuid, c text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  me uuid := app.current_user_id();
  m text;
BEGIN
  IF me IS NULL OR app.board_role(b) IS NULL THEN
    RETURN false;
  END IF;
  SELECT u.mxid INTO m FROM public.board_matrix_users u
  WHERE u.board_id = b AND u.user_id = me AND u.code = c AND u.code_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.board_matrix_users WHERE board_id = b AND mxid = m AND user_id <> me;
  UPDATE public.board_matrix_users SET verified_at = now(), code = NULL, code_expires_at = NULL
  WHERE board_id = b AND user_id = me;
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.confirm_matrix_user(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.confirm_matrix_user(uuid, text) TO kanban_app;
