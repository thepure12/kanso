-- app.board_role runs once per row in almost every select policy (and through
-- app.can_edit in the write policies), so a board GET calls it thousands of
-- times: once per card and once per tag, assignee, checklist item and comment
-- row its counts read. The old body called two more SECURITY DEFINER
-- functions (app.user_board_role, app.token_allows); nested non-inlined SQL
-- functions are planned again on every call, which made each call cost about
-- 0.3 ms and a 300-card board GET about a second. Same result, one query,
-- calling only the inlinable setting readers.
CREATE OR REPLACE FUNCTION app.board_role(b uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT min(r.role) FROM (
    SELECT role FROM public.board_members WHERE board_id = b AND user_id = app.current_user_id()
    UNION ALL
    SELECT tm.role FROM public.boards bd
    JOIN public.team_members tm ON tm.team_id = bd.team_id
    WHERE bd.id = b AND tm.user_id = app.current_user_id()
  ) r
  WHERE (app.token_board_ids() IS NULL OR b = ANY (app.token_board_ids()))
    AND (app.token_team_id() IS NULL
         OR EXISTS (SELECT 1 FROM public.boards WHERE id = b AND team_id = app.token_team_id()))
$$;
