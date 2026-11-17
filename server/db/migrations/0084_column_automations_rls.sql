-- Per-column automations (0083): board_automations.column_id limits an
-- automation to the cards in one column, and move_card moves cards that have
-- been in column_id for `days` days to the end of target_column_id. Both
-- columns are fixed at creation (the UPDATE grant stays (days, active)); the
-- policies of 0056 cover the new columns, the composite FKs keep them on the
-- automation's board. move_card is compared as text: the enum value was added
-- in the same transaction.

-- When the card got into its current column: its last created/moved/restored
-- entry (automation moves count), else its creation.
CREATE FUNCTION app.card_entered_column(card public.cards)
RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT greatest(card.created_at, (SELECT max(created_at) FROM public.card_activity
    WHERE card_id = card.id AND kind IN ('created', 'moved', 'restored')))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.card_entered_column(public.cards) FROM PUBLIC;
--> statement-breakpoint

-- Cards an automation looks at: the open cards of the board (0058), or with a
-- column every live card in that column (the last column too).
CREATE FUNCTION app.automation_cards(b uuid, col uuid)
RETURNS SETOF public.cards
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT * FROM app.automation_open_cards(b) WHERE col IS NULL
  UNION ALL
  SELECT c.* FROM public.cards c
  WHERE col IS NOT NULL AND c.board_id = b AND c.column_id = col
    AND NOT c.is_template AND c.archived_at IS NULL AND c.deleted_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.automation_cards(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

-- As in 0058, plus column_id and move_card. archive_done with a column
-- archives cards that have been in that column for `days` days; without, in
-- the last column as before. move_card goes card by card (oldest arrival
-- first) to the end of the target column, so column rules and the `moved`
-- activity run as for any move; app.user_id is empty, so assign_mover rules
-- assign nobody.
CREATE OR REPLACE FUNCTION app.run_board_automations(only_board uuid DEFAULT NULL)
RETURNS TABLE (automation_id uuid, card_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  a public.board_automations;
  c record;
BEGIN
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.automation', 'on', true);
  FOR a IN
    SELECT ba.* FROM public.board_automations ba
    JOIN public.boards b ON b.id = ba.board_id
    WHERE ba.active AND b.archived_at IS NULL AND (only_board IS NULL OR ba.board_id = only_board)
    ORDER BY ba.created_at
    FOR UPDATE OF ba SKIP LOCKED
  LOOP
    BEGIN
      IF a.kind::text = 'archive_done' THEN
        FOR c IN
          UPDATE public.cards SET archived_at = now()
          WHERE id IN (
            SELECT x.id FROM app.automation_cards(a.board_id,
              coalesce(a.column_id, (SELECT id FROM public.columns WHERE board_id = a.board_id ORDER BY position DESC LIMIT 1))) x
            WHERE app.card_entered_column(x) <= now() - make_interval(days => a.days))
          RETURNING id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'tag_stale' THEN
        FOR c IN
          INSERT INTO public.card_tags (card_id, tag_id, board_id)
          SELECT x.id, a.tag_id, a.board_id FROM app.automation_cards(a.board_id, a.column_id) x
          WHERE app.card_last_activity(x) <= now() - make_interval(days => a.days)
          ON CONFLICT DO NOTHING
          RETURNING card_tags.card_id AS id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'notify_stale' THEN
        FOR c IN
          SELECT x.id FROM app.automation_cards(a.board_id, a.column_id) x
          WHERE app.card_last_activity(x) <= now() - make_interval(days => a.days)
            AND NOT EXISTS (SELECT 1 FROM public.card_activity s
              WHERE s.card_id = x.id AND s.kind = 'stale' AND s.created_at > now() - make_interval(days => a.days))
        LOOP
          PERFORM app.log_activity(c.id, a.board_id, 'stale', jsonb_build_object('days', a.days));
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'raise_priority' THEN
        FOR c IN
          UPDATE public.cards SET priority = a.priority
          WHERE id IN (
            SELECT x.id FROM app.automation_cards(a.board_id, a.column_id) x
            WHERE x.due_date <= current_date + a.days
              AND (x.priority IS NULL OR x.priority < a.priority))
          RETURNING id
        LOOP
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      ELSIF a.kind::text = 'move_card' THEN
        FOR c IN
          SELECT x.id FROM app.automation_cards(a.board_id, a.column_id) x
          WHERE app.card_entered_column(x) <= now() - make_interval(days => a.days)
          ORDER BY app.card_entered_column(x), x.position
        LOOP
          UPDATE public.cards SET column_id = a.target_column_id,
            position = coalesce((SELECT max(position) FROM public.cards WHERE column_id = a.target_column_id), 0) + 1024
          WHERE id = c.id;
          automation_id := a.id; card_id := c.id; RETURN NEXT;
        END LOOP;
      END IF;
      UPDATE public.board_automations SET last_run_at = now() WHERE id = a.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'board automation % failed: %', a.id, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('app.automation', '', true);
END
$$;
