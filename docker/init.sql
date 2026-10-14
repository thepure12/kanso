-- Runs once, as superuser, on first container start.
-- kanban_owner owns the schema and runs migrations.
-- kanban_app is the runtime role: not owner, NOBYPASSRLS, so RLS always applies.
-- kanban_auth is used only by login/register/OAuth handlers, before a user identity exists.
-- Change these passwords outside local development.
CREATE ROLE kanban_owner LOGIN PASSWORD 'kanban_owner' NOBYPASSRLS;
CREATE ROLE kanban_app   LOGIN PASSWORD 'kanban_app'   NOBYPASSRLS;
CREATE ROLE kanban_auth  LOGIN PASSWORD 'kanban_auth'  NOBYPASSRLS;

ALTER DATABASE kanban OWNER TO kanban_owner;
\connect kanban
ALTER SCHEMA public OWNER TO kanban_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext;
