-- Column rules: automations attached to a column. Anyone who can see the board
-- sees its rules; editors and owners add and remove them. Rules are immutable
-- (no UPDATE grant): change one by deleting it and adding another.
-- Composite FKs pin a rule's column and tag to the rule's board.

GRANT SELECT, INSERT, DELETE ON column_rules TO kanban_app;
--> statement-breakpoint

ALTER TABLE column_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY column_rules_select ON column_rules FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY column_rules_insert ON column_rules FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id));
--> statement-breakpoint
CREATE POLICY column_rules_delete ON column_rules FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint

-- Runs the rules of the column a card enters: on insert, and on update when
-- column_id changes (reordering within a column does not re-run them).
-- SECURITY INVOKER: the caller already passed the cards policy, and the
-- card_tags insert goes through card_tags policies as that same caller.
CREATE FUNCTION app.apply_column_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.column_id IS DISTINCT FROM NEW.column_id THEN
    INSERT INTO public.card_tags (card_id, tag_id, board_id)
    SELECT NEW.id, r.tag_id, NEW.board_id
    FROM public.column_rules r
    WHERE r.column_id = NEW.column_id AND r.kind = 'apply_tag'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.apply_column_rules() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.apply_column_rules() TO kanban_app;
--> statement-breakpoint
CREATE TRIGGER cards_apply_column_rules
AFTER INSERT OR UPDATE OF column_id ON cards
FOR EACH ROW EXECUTE FUNCTION app.apply_column_rules();
