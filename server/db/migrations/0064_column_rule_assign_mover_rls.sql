-- assign_mover rules: the person who creates the card in the column or moves
-- it there (app.user_id) becomes an assignee. Skipped without a user (time-based
-- automations) or when that user is not a board member. The recurring-cards task
-- runs as the schedule's owner, so they are assigned to the cards it creates.
-- As in 0012, plus the assign_mover insert. kind is compared as text because
-- 0063 adds the enum value in the same transaction.
CREATE OR REPLACE FUNCTION app.apply_column_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  actor uuid := app.current_user_id();
BEGIN
  IF TG_OP = 'INSERT' OR OLD.column_id IS DISTINCT FROM NEW.column_id THEN
    INSERT INTO public.card_tags (card_id, tag_id, board_id)
    SELECT NEW.id, r.tag_id, NEW.board_id
    FROM public.column_rules r
    WHERE r.column_id = NEW.column_id AND r.kind::text = 'apply_tag'
    ON CONFLICT DO NOTHING;

    DELETE FROM public.card_tags ct
    USING public.column_rules r
    WHERE ct.card_id = NEW.id AND ct.tag_id = r.tag_id
      AND r.column_id = NEW.column_id AND r.kind::text = 'remove_tag';

    INSERT INTO public.card_assignees (card_id, user_id, board_id)
    SELECT NEW.id, r.user_id, NEW.board_id
    FROM public.column_rules r
    WHERE r.column_id = NEW.column_id AND r.kind::text = 'assign_to'
      AND app.is_member(NEW.board_id, r.user_id)
    ON CONFLICT DO NOTHING;

    IF actor IS NOT NULL THEN
      INSERT INTO public.card_assignees (card_id, user_id, board_id)
      SELECT NEW.id, actor, NEW.board_id
      FROM public.column_rules r
      WHERE r.column_id = NEW.column_id AND r.kind::text = 'assign_mover'
        AND app.is_member(NEW.board_id, actor)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END
$$;
