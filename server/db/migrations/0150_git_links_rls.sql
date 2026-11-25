-- GitHub repositories linked to a board (0149). Board owners manage the links
-- (all four policies, like webhooks). The personal access token, sealed by the
-- server, is write-only for kanban_app: no SELECT grant, `has_token` tells
-- whether one is set. Syncing runs as kanban_auth (task git:sync and the
-- "Sync now" route): app.claim_git_links hands out due links with the sealed
-- token, the server fetches the issues from GitHub and app.import_git_issues
-- adds the new open ones as cards in automation mode (actor null, data
-- automation: true), so column rules, activity and notifications run as for
-- any new card. card_git_issues remembers every imported issue (no grants).
ALTER TABLE board_git_links ADD CONSTRAINT board_git_links_provider_known CHECK (provider = 'github');
--> statement-breakpoint
ALTER TABLE board_git_links ADD CONSTRAINT board_git_links_repo_shape
  CHECK (repo ~ '^[a-z0-9_.-]{1,100}/[a-z0-9_.-]{1,100}$');
--> statement-breakpoint
ALTER TABLE board_git_links ADD CONSTRAINT board_git_links_label_length
  CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 100);
--> statement-breakpoint
ALTER TABLE board_git_links ADD CONSTRAINT board_git_links_close_action_known
  CHECK (close_action IN ('none', 'complete'));
--> statement-breakpoint
ALTER TABLE board_git_links ADD CONSTRAINT board_git_links_token_length
  CHECK (token IS NULL OR char_length(token) BETWEEN 1 AND 2000);
--> statement-breakpoint
GRANT SELECT (id, board_id, provider, repo, column_id, label, close_action, has_token, active,
  last_synced_at, last_attempt_at, last_error, created_by, created_at) ON board_git_links TO kanban_app;
--> statement-breakpoint
-- Table-wide (Drizzle names every column); the BEFORE INSERT trigger clears the sync state.
GRANT INSERT ON board_git_links TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (column_id, label, close_action, token, active) ON board_git_links TO kanban_app;
--> statement-breakpoint
GRANT DELETE ON board_git_links TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_git_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_git_links_select ON board_git_links FOR SELECT TO kanban_app
  USING (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY board_git_links_insert ON board_git_links FOR INSERT TO kanban_app
  WITH CHECK (app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id)
    AND created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY board_git_links_update ON board_git_links FOR UPDATE TO kanban_app
  USING (app.board_role(board_id) = 'owner')
  WITH CHECK (app.board_role(board_id) = 'owner');
--> statement-breakpoint
CREATE POLICY board_git_links_delete ON board_git_links FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner');
--> statement-breakpoint
ALTER TABLE card_git_issues ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A new or changed link (other repo, label or token) starts over: the next sync
-- fetches every open issue again (already imported ones are skipped).
CREATE FUNCTION app.reset_git_link_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_synced_at := NULL;
    NEW.last_attempt_at := NULL;
    NEW.last_error := NULL;
  ELSIF NEW.label IS DISTINCT FROM OLD.label OR NEW.token IS DISTINCT FROM OLD.token
     OR (NEW.active AND NOT OLD.active) THEN
    NEW.last_synced_at := NULL;
    NEW.last_error := NULL;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER board_git_links_reset BEFORE INSERT OR UPDATE ON board_git_links
FOR EACH ROW EXECUTE FUNCTION app.reset_git_link_sync();
--> statement-breakpoint

-- Due links (active, unarchived board, not tried in the last 14 minutes), or
-- only `only_link` whenever asked (Sync now), or only the links of
-- `only_board` (tests). Stamps last_attempt_at so other instances skip them.
CREATE FUNCTION app.claim_git_links(only_board uuid DEFAULT NULL, only_link uuid DEFAULT NULL)
RETURNS TABLE (id uuid, board_id uuid, provider text, repo text, label text, token text, since timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH due AS (
    SELECT l.id
    FROM public.board_git_links l
    JOIN public.boards b ON b.id = l.board_id
    WHERE l.active AND b.archived_at IS NULL
      AND (only_board IS NULL OR l.board_id = only_board)
      AND (only_link IS NULL OR l.id = only_link)
      AND (only_link IS NOT NULL OR l.last_attempt_at IS NULL OR l.last_attempt_at < now() - interval '14 minutes')
    ORDER BY l.last_attempt_at NULLS FIRST
    LIMIT 50
    FOR UPDATE OF l SKIP LOCKED
  )
  UPDATE public.board_git_links l SET last_attempt_at = now()
  FROM due WHERE l.id = due.id
  RETURNING l.id, l.board_id, l.provider, l.repo, l.label, l.token, l.last_synced_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.claim_git_links(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_git_links(uuid, uuid) TO kanban_auth;
--> statement-breakpoint

-- Records a failed sync (the error text shown to owners).
CREATE FUNCTION app.fail_git_link(link uuid, error text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  UPDATE public.board_git_links SET last_error = left(error, 500) WHERE id = link
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.fail_git_link(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.fail_git_link(uuid, text) TO kanban_auth;
--> statement-breakpoint

-- Imports fetched issues of a link: `issues` is a JSON array of
-- {number, state: open|closed, title, description, url, labels: [name]}.
-- New open issues become cards at the end of the link's column, with the
-- board's tags whose names match a label (case-insensitively; no tags are
-- created). Closed issues whose card is still open are marked complete when
-- the link's close_action is `complete`. Then the link is marked synced as of
-- `synced_at`. Runs in automation mode. Returns the counts.
CREATE FUNCTION app.import_git_issues(link uuid, issues jsonb, synced_at timestamptz)
RETURNS TABLE (imported integer, completed integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  l public.board_git_links;
  i jsonb;
  new_card uuid;
  n_imported integer := 0;
  n_completed integer := 0;
  prev_user text := coalesce(current_setting('app.user_id', true), '');
  prev_automation text := coalesce(current_setting('app.automation', true), '');
  prev_client text := coalesce(current_setting('app.client_id', true), '');
BEGIN
  SELECT * INTO l FROM public.board_git_links g WHERE g.id = link FOR UPDATE;
  IF NOT FOUND OR NOT l.active OR EXISTS (SELECT 1 FROM public.boards WHERE id = l.board_id AND archived_at IS NOT NULL) THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.automation', 'on', true);
  PERFORM set_config('app.client_id', '', true);
  FOR i IN SELECT * FROM jsonb_array_elements(issues) LOOP
    IF i->>'state' = 'open' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.card_git_issues x
        WHERE x.board_id = l.board_id AND x.provider = l.provider AND x.repo = l.repo AND x.number = (i->>'number')::integer
      ) THEN
        INSERT INTO public.cards (board_id, column_id, title, description, position)
        VALUES (l.board_id, l.column_id, left(i->>'title', 1000), left(coalesce(i->>'description', ''), 10000),
          coalesce((SELECT max(position) FROM public.cards WHERE column_id = l.column_id), 0) + 1024)
        RETURNING id INTO new_card;
        INSERT INTO public.card_tags (card_id, tag_id, board_id)
        SELECT new_card, t.id, l.board_id
        FROM public.tags t
        WHERE t.board_id = l.board_id
          AND lower(t.name) IN (SELECT lower(x) FROM jsonb_array_elements_text(coalesce(i->'labels', '[]'::jsonb)) x)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.card_git_issues (board_id, card_id, link_id, provider, repo, number, url)
        VALUES (l.board_id, new_card, l.id, l.provider, l.repo, (i->>'number')::integer, i->>'url');
        n_imported := n_imported + 1;
      END IF;
    ELSIF i->>'state' = 'closed' AND l.close_action = 'complete' THEN
      UPDATE public.cards c SET completed_at = now()
      FROM public.card_git_issues x
      WHERE x.board_id = l.board_id AND x.provider = l.provider AND x.repo = l.repo
        AND x.number = (i->>'number')::integer AND c.id = x.card_id
        AND c.completed_at IS NULL AND c.deleted_at IS NULL AND NOT c.is_template;
      IF FOUND THEN
        n_completed := n_completed + 1;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.board_git_links SET last_synced_at = synced_at, last_error = NULL WHERE id = link;
  PERFORM set_config('app.user_id', prev_user, true);
  PERFORM set_config('app.automation', prev_automation, true);
  PERFORM set_config('app.client_id', prev_client, true);
  RETURN QUERY SELECT n_imported, n_completed;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.import_git_issues(uuid, jsonb, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.import_git_issues(uuid, jsonb, timestamptz) TO kanban_auth;
