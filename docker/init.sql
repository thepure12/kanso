-- Runs once, as superuser, on first container start.
-- kanban_owner owns the schema and runs migrations.
-- kanban_app is the runtime role: not owner, NOBYPASSRLS, so RLS always applies.
-- kanban_auth is used only by login/register/OAuth handlers, before a user identity exists.
-- Passwords come from psql variables owner_pw, app_pw and auth_pw
-- (psql -v owner_pw=...). Without them the development passwords below are used;
-- docker/init-prod.sh passes real ones.
\if :{?owner_pw}
\else
  \set owner_pw kanban_owner
\endif
\if :{?app_pw}
\else
  \set app_pw kanban_app
\endif
\if :{?auth_pw}
\else
  \set auth_pw kanban_auth
\endif

CREATE ROLE kanban_owner LOGIN PASSWORD :'owner_pw' NOBYPASSRLS;
CREATE ROLE kanban_app   LOGIN PASSWORD :'app_pw'   NOBYPASSRLS;
CREATE ROLE kanban_auth  LOGIN PASSWORD :'auth_pw'  NOBYPASSRLS;

ALTER DATABASE kanban OWNER TO kanban_owner;
\connect kanban
ALTER SCHEMA public OWNER TO kanban_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext;
