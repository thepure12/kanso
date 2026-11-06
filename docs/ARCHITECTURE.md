# Architecture

Kanso's core rule: **Postgres enforces every access rule.** Row-level security policies, `SECURITY DEFINER`
functions and triggers decide who can read and write what. The app holds no permission logic of its own; route
handlers validate input, run queries as the signed-in user and map database errors to HTTP status codes.

## Database roles

Three roles, created in `docker/init.sql`:

| Role | Used by | Notes |
| --- | --- | --- |
| `kanban_owner` | migrations | Owns all tables and the `app` helper functions. |
| `kanban_app` | every board / card / member request | Not owner, `NOBYPASSRLS`. Cannot read `password_hash` or `oauth_accounts`. |
| `kanban_auth` | login, register, OAuth callbacks | Reads and writes `users` and `oauth_accounts` only. |

## Request identity

Each request runs in a transaction that sets `app.user_id` with `set_config(..., true)`. The setting is
transaction-local, so pooled connections never carry an identity to the next request. See `withUser` in
`server/utils/db.ts`.

## Policies

Policies live in `server/db/migrations/0001_rls.sql` and `0003_teams_rls.sql`. Highlights:

**Boards and teams**

- `app.board_role(board_id)` returns the caller's effective role: the stronger of the direct board role and the team
  role. It is `SECURITY DEFINER` so policies on `board_members` do not recurse.
- New boards go through `app.create_board(name)`, which inserts the board and the owner membership together.
- `app.add_board_member(board_id, email, role)` checks that the caller is an owner, then looks up the email. Callers
  cannot read users who do not share a board with them.
- Teams are created through `app.create_team(name)` and members are added with `app.add_team_member(team_id, email, role)`.
- A board's team is set at creation and cannot change (column-level `UPDATE` grant on `boards.name` only).
- Triggers keep at least one owner on each team and on each personal board.
- Archived boards: `app.can_edit` is false while `boards.archived_at` is set, so every content write policy blocks
  owners and editors alike. Only owners archive and unarchive, through `app.set_board_archived`.
- Stars (`board_stars`) are personal: each user reads, adds and removes only their own, on boards they can see.
- `app.copy_board(...)` runs as the caller, so the copy reads and writes through the normal policies.

**Cards**

- `cards (column_id, board_id)` has a composite foreign key to `columns (id, board_id)`, so a card cannot move into
  another board's column.
- Card data in other tables (tags, assignees, checklist items, comments, attachments, time entries, watchers, links,
  activity) carries `board_id` with a composite foreign key to `cards (id, board_id)`, so it cannot point at another
  board's card.
- Comments and time entries: editors and owners write them as themselves; authors edit their own; authors and board
  owners delete them.
- A card's cover must be an image attachment of the same card (trigger); deleting the image clears it.
- Watchers: anyone who can see the board watches and unwatches for themselves only. Card links: viewers read, editors
  add and remove; a trigger rejects blocking cycles.
- Custom fields: viewers read definitions and values, editors manage both. Triggers check each value against its
  field's type (a select value must be one of its options) and clear values when their select option is removed.
- The activity log is written by triggers only; `kanban_app` can read it but not write it.
- Card templates are cards with `is_template` set (fixed at creation); `app.copy_card(...)` copies cards to and from
  templates as the caller. Recurring schedules (`card_recurrences`): viewers read, editors manage;
  `app.run_due_recurrences()` (only `kanban_auth`) creates the cards as the schedule's last editor and switches the
  schedule off once they can no longer edit the board.

**Accounts and integrations**

- Two-factor secrets and recovery codes (`user_totp`, `user_recovery_codes`) are readable by `kanban_auth` only.
- Users read and revoke (never un-revoke) their own `user_sessions`; `app.check_session` checks the session row and
  version on each request.
- `admin_audit_log` is written only by `SECURITY DEFINER` triggers and admin functions and read only by admins.
- API tokens (`api_tokens`): users create, list and revoke their own; `kanban_app` cannot read `token_hash`. Requests
  resolve a token through `app.resolve_api_token(sha256)` (only `kanban_auth`).
- Webhooks (`board_webhooks`): owners only; the secret can be written but not read back. The outbox
  (`webhook_deliveries`) has no grants: a trigger on `card_activity` fills it and `kanban_auth` functions claim and
  finish deliveries.

Policies for these live in `0012_card_features_rls.sql`, `0014_board_notify_copy.sql`, `0029_card_schedule_time_rls.sql`,
`0031_watchers_links_rls.sql`, `0033_board_fields_rls.sql`, `0035_board_stars_archive_rls.sql`,
`0037_card_templates_recurring_rls.sql`, `0039_two_factor_sessions_audit_rls.sql` and `0041_api_tokens_webhooks_rls.sql`.

## Live updates

Triggers on every board table send `NOTIFY board_changes` with the board id and the browser tab's id (`x-client-id`
header, stored in the transaction setting `app.client_id`). The payload holds no board data.

`GET /api/boards/:id/events` is a server-sent event stream: it sends `change` when someone else changed the board, and
the page refetches the board through RLS. Access is checked again before each event; the stream sends `gone` and
closes once the user loses access.

## Translations

UI text lives in `i18n/locales/<code>.json` (`@nuxtjs/i18n`, lazy-loaded, no URL prefixes). Components use
`useI18n().t('key')`; never hard-code UI text.

- **New string:** add the key to every locale file. `tests/unit/i18n.test.ts` checks that all locales have the same
  keys and placeholders and that messages compile.
- **New locale:** add its file, its entry in `nuxt.config.ts` (`i18n.locales`), `shared/i18n.ts` (`locales`), the
  `users_locale_check` constraint and the Nuxt UI locale in `app/app.vue`.

Emails and webhook messages are rendered on the server from the same files (`server/utils/i18n.ts`).

## Schema changes

Edit `server/db/schema.ts`, then run `pnpm db:generate` and `pnpm db:migrate`. Generated migrations contain no RLS:
add policies and grants for new tables in a custom migration (`pnpm drizzle-kit generate --custom`) and add RLS tests
in `tests/`.
