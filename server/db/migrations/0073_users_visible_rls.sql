-- users_select called app.shares_board(id) for every row of users, so any
-- query on users (people suggestions, board members, assignees) cost about a
-- millisecond per account in the instance. app.visible_user_ids() returns the
-- same set (people sharing a team, or a board through either side's direct or
-- team membership) once per query; the policy uses it as an uncorrelated
-- subquery, which Postgres evaluates once and hashes.
CREATE FUNCTION app.visible_user_ids() RETURNS SETOF uuid
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
  SELECT o.user_id FROM public.team_members a
  JOIN public.team_members o ON o.team_id = a.team_id, me
  WHERE a.user_id = me.id
  UNION
  SELECT bm.user_id FROM public.board_members bm
  JOIN my_boards mb ON mb.board_id = bm.board_id
  UNION
  SELECT tm.user_id FROM my_boards mb
  JOIN public.boards bd ON bd.id = mb.board_id
  JOIN public.team_members tm ON tm.team_id = bd.team_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.visible_user_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.visible_user_ids() TO kanban_app;
--> statement-breakpoint
DROP POLICY users_select ON users;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT TO kanban_app
  USING (id = app.current_user_id() OR id IN (SELECT app.visible_user_ids()));
