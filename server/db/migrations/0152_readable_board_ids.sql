-- Select policies checked `app.board_role(board_id) IS NOT NULL` per row. The
-- function is SECURITY DEFINER, so the planner cannot inline it and calls it
-- once per row read: a 1,000-card board GET reads about 20,000 child rows
-- (tags, assignees, checklist items, comments, ...) and spent about 0.9 s in
-- those calls. app.readable_board_ids() returns the same boards as a set, which
-- Postgres evaluates once per query and hashes (as users_select does with
-- app.visible_user_ids()). Same rule as board_role: direct members and team
-- members, within the token's board or team limit. Write, owner and
-- limited-member checks are unchanged.
CREATE FUNCTION app.readable_board_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT r.b FROM (
    SELECT board_id AS b FROM public.board_members WHERE user_id = app.current_user_id()
    UNION
    SELECT bd.id FROM public.boards bd
    JOIN public.team_members tm ON tm.team_id = bd.team_id
    WHERE tm.user_id = app.current_user_id()
  ) r
  WHERE (app.token_board_ids() IS NULL OR r.b = ANY (app.token_board_ids()))
    AND (app.token_team_id() IS NULL
         OR EXISTS (SELECT 1 FROM public.boards WHERE id = r.b AND team_id = app.token_team_id()))
$$;
--> statement-breakpoint
ALTER POLICY assignee_group_members_select ON public.assignee_group_members USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY assignee_groups_select ON public.assignee_groups USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY board_agent_rules_select ON public.board_agent_rules USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (bot_id = app.current_user_id()))));
--> statement-breakpoint
ALTER POLICY board_automations_select ON public.board_automations USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (((card_id IS NULL) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids))) AND ((column_id IS NULL) OR (column_id IN ( SELECT app.limited_column_ids() AS limited_column_ids))) AND ((target_column_id IS NULL) OR (target_column_id IN ( SELECT app.limited_column_ids() AS limited_column_ids)))))));
--> statement-breakpoint
ALTER POLICY board_backgrounds_select ON public.board_backgrounds USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY board_button_cards_select ON public.board_button_cards USING ((((board_id IN (SELECT app.readable_board_ids()))) AND (EXISTS ( SELECT 1
   FROM board_buttons bb
  WHERE (bb.id = board_button_cards.button_id))) AND (EXISTS ( SELECT 1
   FROM cards c
  WHERE (c.id = board_button_cards.card_id)))));
--> statement-breakpoint
ALTER POLICY board_buttons_select ON public.board_buttons USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((user_id IS NULL) OR (user_id = app.current_user_id()))));
--> statement-breakpoint
ALTER POLICY board_fields_select ON public.board_fields USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY board_matrix_rooms_select ON public.board_matrix_rooms USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY board_matrix_users_select ON public.board_matrix_users USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((user_id = app.current_user_id()) OR (verified_at IS NOT NULL))));
--> statement-breakpoint
ALTER POLICY members_select ON public.board_members USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY board_notification_settings_select ON public.board_notification_settings USING (((user_id = app.current_user_id()) AND ((board_id IN (SELECT app.readable_board_ids())))));
--> statement-breakpoint
ALTER POLICY board_rules_select ON public.board_rules USING ((((board_id IN (SELECT app.readable_board_ids()))) AND (NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids)))));
--> statement-breakpoint
ALTER POLICY board_stars_select ON public.board_stars USING (((user_id = app.current_user_id()) AND ((board_id IN (SELECT app.readable_board_ids())))));
--> statement-breakpoint
ALTER POLICY boards_select ON public.boards USING (((id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY card_activity_select ON public.card_activity USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids))) AND ((kind <> 'reminder'::text) OR (NOT (data ? 'user_id'::text)) OR ((data ->> 'user_id'::text) = (app.current_user_id())::text))));
--> statement-breakpoint
ALTER POLICY card_assignees_select ON public.card_assignees USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_attachments_select ON public.card_attachments USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_comments_select ON public.card_comments USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_field_values_select ON public.card_field_values USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_links_select ON public.card_links USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR ((from_card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)) AND (to_card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids))))));
--> statement-breakpoint
ALTER POLICY card_matrix_threads_select ON public.card_matrix_threads USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_recurrences_select ON public.card_recurrences USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (template_card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_reminders_select ON public.card_reminders USING (((user_id = app.current_user_id()) AND ((board_id IN (SELECT app.readable_board_ids()))) AND app.can_see_card(card_id)));
--> statement-breakpoint
ALTER POLICY card_scheduled_actions_select ON public.card_scheduled_actions USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_tags_select ON public.card_tags USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY card_watchers_select ON public.card_watchers USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY cards_select ON public.cards USING (((deleted_at IS NULL) AND ((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (id IN ( SELECT app.limited_card_ids() AS limited_card_ids)) OR (app.my_access(board_id, column_id, id) <> 'none'::board_access))));
--> statement-breakpoint
ALTER POLICY checklist_items_select ON public.checklist_items USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY checklists_select ON public.checklists USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY column_group_members_select ON public.column_group_members USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (column_id IN ( SELECT app.limited_column_ids() AS limited_column_ids)))));
--> statement-breakpoint
ALTER POLICY column_groups_select ON public.column_groups USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY column_rules_select ON public.column_rules USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (column_id IN ( SELECT app.limited_column_ids() AS limited_column_ids)))));
--> statement-breakpoint
ALTER POLICY columns_select ON public.columns USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (id IN ( SELECT app.limited_column_ids() AS limited_column_ids)))));
--> statement-breakpoint
ALTER POLICY comment_reactions_select ON public.comment_reactions USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (comment_id IN ( SELECT c.id
   FROM card_comments c
  WHERE (c.card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))))));
--> statement-breakpoint
ALTER POLICY invites_select ON public.invites USING ((((board_id IN (SELECT app.readable_board_ids()))) OR (app.team_role(team_id) IS NOT NULL)));
--> statement-breakpoint
ALTER POLICY notifications_select ON public.notifications USING (((user_id = app.current_user_id()) AND ((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
--> statement-breakpoint
ALTER POLICY saved_views_select ON public.saved_views USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((user_id IS NULL) OR (user_id = app.current_user_id()))));
--> statement-breakpoint
ALTER POLICY tags_select ON public.tags USING (((board_id IN (SELECT app.readable_board_ids()))));
--> statement-breakpoint
ALTER POLICY time_entries_select ON public.time_entries USING ((((board_id IN (SELECT app.readable_board_ids()))) AND ((NOT (board_id IN ( SELECT app.limited_board_ids() AS limited_board_ids))) OR (card_id IN ( SELECT app.limited_card_ids() AS limited_card_ids)))));
