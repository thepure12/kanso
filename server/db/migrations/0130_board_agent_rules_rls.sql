-- Agent rules (board_agent_rules, 0129): "when <event>, the bot works on the
-- card with these instructions". The database only stores them; the runner
-- (`kanso agent run --board` with the bot's token) reads them and follows the
-- event stream.
--
-- Anyone who can see the board reads its rules, except members with limited
-- access (rules may name columns they cannot see), who read only the rules of
-- their own bot user (a limited bot still follows its rules). Editors manage
-- them; created_by is the caller. The bot must be a bot with access to the
-- board (board, team or account bot); else 42501.
GRANT SELECT, INSERT, DELETE ON board_agent_rules TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (name, bot_id, event, column_id, tag_id, instructions, move_column_id, comment, active) ON board_agent_rules TO kanban_app;
--> statement-breakpoint
ALTER TABLE board_agent_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_agent_rules_select ON board_agent_rules FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR bot_id = app.current_user_id()));
--> statement-breakpoint
CREATE FUNCTION app.agent_rule_bot_ok(b uuid, bot uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = bot AND u.is_bot) AND app.is_member(b, bot)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.agent_rule_bot_ok(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.agent_rule_bot_ok(uuid, uuid) TO kanban_app;
--> statement-breakpoint
CREATE POLICY board_agent_rules_insert ON board_agent_rules FOR INSERT TO kanban_app
  WITH CHECK (app.can_edit(board_id) AND created_by = app.current_user_id() AND app.agent_rule_bot_ok(board_id, bot_id));
--> statement-breakpoint
CREATE POLICY board_agent_rules_update ON board_agent_rules FOR UPDATE TO kanban_app
  USING (app.can_edit(board_id)) WITH CHECK (app.can_edit(board_id) AND app.agent_rule_bot_ok(board_id, bot_id));
--> statement-breakpoint
CREATE POLICY board_agent_rules_delete ON board_agent_rules FOR DELETE TO kanban_app
  USING (app.can_edit(board_id));
--> statement-breakpoint
CREATE TRIGGER board_agent_rules_notify AFTER INSERT OR UPDATE OR DELETE ON board_agent_rules
FOR EACH ROW EXECUTE FUNCTION app.notify_board_change('board_id');
