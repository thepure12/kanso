-- assign_to rules: a rule may only name someone with access to the board.
-- If that person later loses access, the rule stays but is skipped (the cards
-- policies would reject the assignment anyway).

DROP POLICY column_rules_insert ON column_rules;
--> statement-breakpoint
CREATE POLICY column_rules_insert ON column_rules FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND (user_id IS NULL OR app.is_member(board_id, user_id)));
--> statement-breakpoint

-- BEFORE trigger: sets the assignee on the row itself, so the cards policies
-- check the final row (the AFTER trigger cannot change NEW).
-- Same firing rule as app.apply_column_rules(): insert, or column_id changed.
CREATE FUNCTION app.assign_column_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  assignee uuid;
BEGIN
  IF TG_OP = 'INSERT' OR OLD.column_id IS DISTINCT FROM NEW.column_id THEN
    SELECT r.user_id INTO assignee
    FROM public.column_rules r
    WHERE r.column_id = NEW.column_id AND r.kind = 'assign_to'
      AND app.is_member(NEW.board_id, r.user_id);
    IF FOUND THEN
      NEW.assignee_id := assignee;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.assign_column_rules() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.assign_column_rules() TO kanban_app;
--> statement-breakpoint
CREATE TRIGGER cards_assign_column_rules
BEFORE INSERT OR UPDATE OF column_id ON cards
FOR EACH ROW EXECUTE FUNCTION app.assign_column_rules();
