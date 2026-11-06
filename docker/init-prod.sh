#!/bin/sh
# Production database init (docker-compose.prod.yml): runs docker/init.sql once,
# on first start, with the role passwords from the environment.
set -eu

: "${KANBAN_OWNER_PASSWORD:?}" "${KANBAN_APP_PASSWORD:?}" "${KANBAN_AUTH_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$KANBAN_OWNER_PASSWORD" \
  -v app_pw="$KANBAN_APP_PASSWORD" \
  -v auth_pw="$KANBAN_AUTH_PASSWORD" \
  -f /docker/init.sql
