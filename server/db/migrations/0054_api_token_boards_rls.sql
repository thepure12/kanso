-- API tokens limited to boards (api_tokens.board_ids; null = every board).
-- withUser puts the token's boards into the transaction setting
-- app.token_boards, like app.user_id. app.board_role answers null for other
-- boards, so every board policy and function follows without changes. Teams
-- stay readable but a limited token acts as a team viewer at most, and it
-- cannot create boards or teams (it could not reach them).

CREATE FUNCTION app.token_board_ids() RETURNS uuid[]
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.token_boards', true), '')::uuid[] $$;
--> statement-breakpoint

-- Whether the request may reach board b: always, unless a limited API token sent it.
CREATE FUNCTION app.token_allows(b uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT app.token_board_ids() IS NULL OR b = ANY (app.token_board_ids()) $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.board_role(b uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT app.user_board_role(b, app.current_user_id()) WHERE app.token_allows(b) $$;
--> statement-breakpoint

-- board_role order is owner < editor < viewer, so greatest() caps at viewer.
CREATE OR REPLACE FUNCTION app.team_role(t uuid) RETURNS public.board_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN app.token_board_ids() IS NULL THEN role ELSE greatest(role, 'viewer') END
  FROM public.team_members
  WHERE team_id = t AND user_id = app.current_user_id()
$$;
--> statement-breakpoint

CREATE FUNCTION app.refuse_limited_token() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app.token_board_ids() IS NOT NULL THEN
    RAISE EXCEPTION 'this API token is limited to some boards' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER boards_refuse_limited_token BEFORE INSERT ON boards
  FOR EACH ROW EXECUTE FUNCTION app.refuse_limited_token();
--> statement-breakpoint
CREATE TRIGGER teams_refuse_limited_token BEFORE INSERT ON teams
  FOR EACH ROW EXECUTE FUNCTION app.refuse_limited_token();
--> statement-breakpoint

-- Personal rows on boards out of the token's reach stay untouched.
DROP POLICY notifications_update ON notifications;
--> statement-breakpoint
CREATE POLICY notifications_update ON notifications FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id() AND app.token_allows(board_id))
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
DROP POLICY notifications_delete ON notifications;
--> statement-breakpoint
CREATE POLICY notifications_delete ON notifications FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id() AND app.token_allows(board_id));
--> statement-breakpoint
DROP POLICY card_watchers_delete ON card_watchers;
--> statement-breakpoint
CREATE POLICY card_watchers_delete ON card_watchers FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id() AND app.token_allows(board_id));
--> statement-breakpoint
DROP POLICY board_stars_delete ON board_stars;
--> statement-breakpoint
CREATE POLICY board_stars_delete ON board_stars FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id() AND app.token_allows(board_id));
--> statement-breakpoint
-- Leaving a team drops access to its boards: not for limited tokens.
DROP POLICY team_members_delete ON team_members;
--> statement-breakpoint
CREATE POLICY team_members_delete ON team_members FOR DELETE TO kanban_app
  USING (app.team_role(team_id) = 'owner' OR (user_id = app.current_user_id() AND app.token_board_ids() IS NULL));
--> statement-breakpoint

-- A token can only be limited to boards its owner can see.
DROP POLICY api_tokens_insert ON api_tokens;
--> statement-breakpoint
CREATE POLICY api_tokens_insert ON api_tokens FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id() AND revoked_at IS NULL AND last_used_at IS NULL
    AND (board_ids IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(board_ids) b WHERE app.board_role(b) IS NULL)));
--> statement-breakpoint
GRANT SELECT (board_ids) ON api_tokens TO kanban_app;
--> statement-breakpoint

DROP FUNCTION app.resolve_api_token(text);
--> statement-breakpoint
CREATE FUNCTION app.resolve_api_token(hash text)
RETURNS TABLE (token_id uuid, user_id uuid, scopes text[], board_ids uuid[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  t public.api_tokens;
BEGIN
  SELECT k.* INTO t FROM public.api_tokens k
  JOIN public.users u ON u.id = k.user_id
  WHERE k.token_hash = hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now());
  IF NOT FOUND THEN RETURN; END IF;
  IF t.last_used_at IS NULL OR t.last_used_at < now() - interval '5 minutes' THEN
    UPDATE public.api_tokens SET last_used_at = now() WHERE id = t.id;
  END IF;
  RETURN QUERY SELECT t.id, t.user_id, t.scopes, t.board_ids;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_api_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_api_token(text) TO kanban_auth;
