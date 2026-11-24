-- My work panels: personal rows. Each user reads, adds, changes and deletes
-- only their own panels (owner fixed: no UPDATE grant on user_id). No notify
-- trigger: nobody else's view changes. The routes are cookie only (not in
-- tokenRoutes).
GRANT SELECT, INSERT, UPDATE (name, config, position), DELETE ON my_work_panels TO kanban_app;
--> statement-breakpoint
ALTER TABLE my_work_panels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY my_work_panels_select ON my_work_panels FOR SELECT TO kanban_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY my_work_panels_insert ON my_work_panels FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY my_work_panels_update ON my_work_panels FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY my_work_panels_delete ON my_work_panels FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
