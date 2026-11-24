-- Custom views (0132): a person's own named set of columns from any boards.
-- Personal rows only: everyone reads and manages just their own views.
-- A column goes in only while the person can see it (the columns policies,
-- so limited members only their visible columns); columns they lose access to
-- later stay in the table but reads join columns under RLS and skip them.
-- No notify triggers: nothing on a board changes.
GRANT SELECT, INSERT, DELETE ON custom_views TO kanban_app;
--> statement-breakpoint
GRANT UPDATE (name) ON custom_views TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON custom_view_columns TO kanban_app;
--> statement-breakpoint
ALTER TABLE custom_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE custom_view_columns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY custom_views_own ON custom_views FOR ALL TO kanban_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY custom_view_columns_select ON custom_view_columns FOR SELECT TO kanban_app
  USING (view_id IN (SELECT v.id FROM custom_views v));
--> statement-breakpoint
CREATE POLICY custom_view_columns_delete ON custom_view_columns FOR DELETE TO kanban_app
  USING (view_id IN (SELECT v.id FROM custom_views v));
--> statement-breakpoint
CREATE POLICY custom_view_columns_insert ON custom_view_columns FOR INSERT TO kanban_app
  WITH CHECK (
    custom_view_columns.view_id IN (SELECT v.id FROM custom_views v)
    AND EXISTS (SELECT 1 FROM columns c
      WHERE c.id = custom_view_columns.column_id AND c.board_id = custom_view_columns.board_id)
  );
