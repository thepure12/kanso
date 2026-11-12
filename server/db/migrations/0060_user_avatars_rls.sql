-- Profile pictures: user_avatars holds the image a user uploaded, and
-- users.avatar_url (already updatable by its owner, 0001) points at
-- GET /api/users/:id/avatar.
--
-- Everyone who can see the user (users_select / users_select_admin) sees the
-- picture; only the user changes it.

GRANT SELECT, INSERT, UPDATE (content_type, size, data, created_at), DELETE ON user_avatars TO kanban_app;
--> statement-breakpoint

ALTER TABLE user_avatars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The subquery runs under the caller's users policies.
CREATE POLICY user_avatars_select ON user_avatars FOR SELECT TO kanban_app
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = user_avatars.user_id));
--> statement-breakpoint
CREATE POLICY user_avatars_insert ON user_avatars FOR INSERT TO kanban_app
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY user_avatars_update ON user_avatars FOR UPDATE TO kanban_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY user_avatars_delete ON user_avatars FOR DELETE TO kanban_app
  USING (user_id = app.current_user_id());
