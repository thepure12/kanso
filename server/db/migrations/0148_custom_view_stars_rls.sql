-- Starred custom views (0147): the owner stars and unstars their own views.
-- custom_views_own already limits every row to its user, so a column grant is enough.
GRANT UPDATE (starred_at) ON custom_views TO kanban_app;
