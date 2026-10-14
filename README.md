# Kanso

By PureApps.

Shared kanban boards. Nuxt 4, Nuxt UI, Postgres with row-level security, Drizzle ORM.

## Features

- Sign in with email + password, Discord, GitHub or Google (`nuxt-auth-utils`).
- Boards with columns and cards. Drag and drop for cards and columns.
- Share a board by email with a role:
  - **owner**: full control, manages members, renames and deletes the board
  - **editor**: creates, edits, moves and deletes columns and cards
  - **viewer**: read only
- **Teams** group people and boards. A team member's role (owner / editor / viewer) applies to every board in the team.
  Team owners manage members and can rename or delete the team (which deletes its boards). Team owners and editors can create team boards.
  You can also add guests to a single team board. A person's effective role is the stronger of their team role and their board role.
- Boards outside a team are personal: only people added to the board have access.
- Each team has a page (click its name on the home page or above a board's name) with its boards and members:
  owners rename or delete the team and manage members and invites; anyone can leave.
- **Star** boards (star on a board tile or in the board header): starred boards come first on the home page and in the command palette.
- Owners can **archive** a board (board menu): it becomes read-only for everyone, moves to **Archived boards** on the home page,
  drops out of search (unless archived results are asked for), notifications and the digest. Owners unarchive it from the board's banner.
- The board menu's **Activity** shows every card change on the board, newest first, each linking to its card.
- Cards have a Markdown description, tags, several assignees, a start and due date, a priority, an estimate
  (story points, summed in the column header), a checklist, comments, file attachments (up to 10 MB each,
  stored in Postgres; an image can be the card's cover), time tracking (log time as `1h30m`, `45m` or `1:30`)
  and an activity log.
  Archive a card to hide it from the board; restore it from **Archived cards**.
- **Card templates**: "Save as template" in a card's dialog keeps a copy (description, tags, checklist, estimate, priority,
  field values and optionally assignees) off the board. Add cards from it with a column's template button; manage
  templates from the board menu (**Templates**). A template can **repeat** daily, weekly (chosen weekdays) or monthly,
  every N days/weeks/months: a new card appears in the chosen column, optionally with a due date a few days later.
- **Custom fields** per board (board menu, **Fields**): text, number, date, select (options with colours), checkbox and link.
  Set values in the card dialog; fields marked "show on cards" appear as chips on the board. Editors manage fields.
- Search and filter a board by text, tag, assignee, priority, due date, start date and select/checkbox field values.
- Board views (`?view=`, last choice remembered per board): Board, sortable/groupable List (inline status change), month Calendar (drag a card to another day to change its due or start date) and a read-only Timeline (start to due bars, week/month zoom). Swimlanes in the Board view group cards by assignee, priority, tag or a select field.
- Search across all your boards (cards, comments, board and column names) from the command palette:
  **Ctrl/Cmd+K** or the header search button. It also jumps to boards and runs actions. Press **?** for keyboard shortcuts.
- Live updates: changes by other people appear without a reload.
- **Installable app** (PWA): install Kanso from the browser (or the user menu's **Install app**). Boards and cards you
  opened stay viewable offline, read-only, with an offline banner; the board reloads when you are back online. A toast
  offers **Reload** when a new version is deployed. The offline copy belongs to the signed-in user and is deleted on
  sign-out or when someone else signs in on the device; still, sign out on shared devices. Only in production builds
  (`pnpm build`), and service workers need HTTPS (or localhost).
- **Undo** your recent board changes (moves, archiving, card and column edits, field values, deleted checklist items)
  from the toast or with **Ctrl/Cmd+Z** (**Ctrl/Cmd+Shift+Z** redoes). Deleting a card asks first and offers to archive instead.
- Columns can have a colour, a soft WIP limit (the column turns red when over it) and rules that run
  when a card enters the column: apply a tag, remove a tag, add an assignee, set the due date.
- New boards start from a template (Basic, Scrum, Bug tracking, Empty). Copy a board, with or without
  its cards. Export a board as JSON or its cards as CSV.
- Forgot your password? Reset it by email. The **Account** page changes your name, email (confirmed by a link to the new address)
  and password, turns on a daily email digest of unread notifications, and deletes your account.
- **Two-factor authentication** (Account page): TOTP from any authenticator app (QR code or key), plus ten one-time
  recovery codes shown once. It is asked for after the password and also after OAuth sign-ins, emailed sign-in links
  and password resets. New recovery codes need a code from the app; turning it off needs the password or a code.
  Secrets are encrypted at rest (AES-256-GCM) with `NUXT_TOTP_KEY`, or a key derived from `NUXT_SESSION_PASSWORD`;
  changing that key makes existing secrets unreadable (users sign in with a recovery code and set it up again).
- **Sessions** (Account page): every signed-in device with browser, IP and last activity; sign one out, or all the others.
  Sessions from before this feature carry no session id and must sign in again.
- **Audit log** (Admin page): promotions, demotions, the admin bootstrap, account removals and self-deletions, and sign-up
  setting changes, with names kept after accounts are deleted. Admins only.
- **My work** (header, `g m`): the cards assigned to you or that you watch on all your boards, grouped by due date
  (overdue, today, next 7 days, later, no date). Cards in a board's last column count as done and are hidden unless you ask.
- **Bulk actions**: Shift/Ctrl/Cmd+click cards (or tick them in the list view) to move, tag, assign, prioritise, date or
  archive them together; one undo reverts the whole change.
- Mention people in comments with `@`; they get a notification even when they are not assigned.
- **Watch** a card (eye button in the card dialog) to get the same notifications as its assignees. You watch cards you
  create or comment on automatically; the board marks watched cards with an eye.
- **Link** cards on the same board: *blocks*, *relates to*, *duplicates*. A card shows a **Blocked** badge while a card
  that blocks it is still open, meaning not archived and not in the board's last column (the last column counts as "done").
  Blocking links cannot form a cycle.
- Import a board (new-board dialog, template "Import from file") from a Kanso JSON export, a Trello board JSON export,
  or a CSV with a header row (Jira exports, spreadsheets, Kanso's own CSV export). A preview shows the counts and the
  people who were not found before anything is created. Comments and attachments are not imported; assignees are kept
  only when they can access the new board (matched by email, or by name for Trello and CSV).
- **API tokens** (Account page): personal access tokens (`Authorization: Bearer kb_...`), read only or read and write,
  with an optional expiry. They work on board, card and team routes but never on account, sign-in or admin routes.
  See [docs/API.md](docs/API.md) for the routes and examples.
- **Webhooks** (board menu, owners): send a board's card activity to a URL as signed JSON, or as Slack or Discord
  messages, optionally only some kinds of activity. Retried with backoff, turned off after 20 failures in a row, test
  button, last status shown. Only public addresses are reachable (see [docs/API.md](docs/API.md#webhooks)).
- **English and German.** The UI follows the browser's language (remembered in a cookie) until you pick one on the
  Account page; that choice is saved on the account and also sets the language of your emails and of the Slack/Discord
  messages of webhooks you create.
- Login, sign-up and password reset attempts are rate limited per IP (and email for login), stored in Postgres so limits hold across restarts and instances.
- Postgres enforces all access rules. The app holds no permission logic of its own.

Planned features: [docs/ROADMAP.md](docs/ROADMAP.md).

## Setup

```bash
pnpm install
cp .env.example .env          # set NUXT_SESSION_PASSWORD (32+ chars) and OAuth keys
pnpm db:up                    # Postgres 17; docker/init.sql creates the roles
pnpm db:migrate               # runs as kanban_owner
pnpm dev
```

Run the tests against the migrated database:

```bash
pnpm test                          # everything
pnpm vitest run --project db       # RLS, triggers, SQL functions
pnpm vitest run --project unit     # frontend helpers
pnpm vitest run --project components
pnpm vitest run --project api      # builds the app and calls its HTTP API (about 1.5 minutes)
```

CI (`.github/workflows/ci.yml`) runs the migrations, the type check and all test projects against a Postgres 17 service.

### Docker

The `Dockerfile` builds the app and runs `.output/server/index.mjs` as a non-root user. To run everything in containers:

```bash
cp .env.example .env          # set NUXT_SESSION_PASSWORD, NUXT_PUBLIC_SITE_URL, mail settings
docker compose --profile app up -d --build
```

This starts Postgres, runs the migrations once (`migrate` service) and then the app on port 3000.
Inside compose the database URLs point at host `db` (set in `docker-compose.yml`, overriding `.env`), using the
development passwords from `docker/init.sql`; change both for a real deployment. To migrate again after an update:
`docker compose --profile app run --rm migrate`. The container runs with `NODE_ENV=production`, so session cookies
are `Secure`: serve it over HTTPS (or on `localhost`).

### OAuth

Set the client ID and secret in `.env`. The login page shows only providers that have credentials set.
Callback URLs:

| Provider | Callback URL |
| --- | --- |
| Discord | `http://localhost:3000/auth/discord` |
| GitHub | `http://localhost:3000/auth/github` |
| Google | `http://localhost:3000/auth/google` |

An OAuth login links to an existing account with the same email only when the provider reports the email as verified.

## How RLS works

Three database roles, created in `docker/init.sql`:

| Role | Used by | Notes |
| --- | --- | --- |
| `kanban_owner` | migrations | Owns all tables and the `app` helper functions. |
| `kanban_app` | every board / card / member request | Not owner, `NOBYPASSRLS`. Cannot read `password_hash` or `oauth_accounts`. |
| `kanban_auth` | login, register, OAuth callbacks | Reads and writes `users` and `oauth_accounts` only. |

Each request runs in a transaction that sets `app.user_id` with `set_config(..., true)`.
The setting is transaction-local, so pooled connections never carry an identity to the next request.
See `withUser` in `server/utils/db.ts`.

Policies live in `server/db/migrations/0001_rls.sql` and `0003_teams_rls.sql`. Highlights:

- `app.board_role(board_id)` returns the caller's effective role: the stronger of the direct board role and the team role. It is `SECURITY DEFINER` so policies on `board_members` do not recurse.
- New boards go through `app.create_board(name)`, which inserts the board and the owner membership together.
- `app.add_board_member(board_id, email, role)` checks that the caller is an owner, then looks up the email. Callers cannot read users who do not share a board with them.
- Teams are created through `app.create_team(name)` and members are added with `app.add_team_member(team_id, email, role)`.
- A board's team is set at creation and cannot change (column-level `UPDATE` grant on `boards.name` only).
- Triggers keep at least one owner on each team and on each personal board.
- `cards (column_id, board_id)` has a composite foreign key to `columns (id, board_id)`, so a card cannot move into another board's column.
- Card data in other tables (tags, assignees, checklist items, comments, attachments, time entries, watchers, links, activity) carries `board_id` with a composite foreign key to `cards (id, board_id)`, so it cannot point at another board's card.
- Comments and time entries: editors and owners write them as themselves; authors edit their own; authors and board owners delete them.
- A card's cover must be an image attachment of the same card (trigger); deleting the image clears it.
- Watchers: anyone who can see the board watches and unwatches for themselves only. Card links: viewers read, editors add and remove; a trigger rejects blocking cycles.
- Custom fields: viewers read definitions and values, editors manage both. Triggers check each value against its field's type (a select value must be one of its options) and clear values when their select option is removed.
- The activity log is written by triggers only; `kanban_app` can read it but not write it.
- Archived boards: `app.can_edit` is false while `boards.archived_at` is set, so every content write policy blocks owners and editors alike. Only owners archive and unarchive, through `app.set_board_archived`.
- Stars (`board_stars`) are personal: each user reads, adds and removes only their own, on boards they can see.
- `app.copy_board(...)` runs as the caller, so the copy reads and writes through the normal policies.
- Two-factor secrets and recovery codes (`user_totp`, `user_recovery_codes`) are readable by `kanban_auth` only. Users read and revoke (never un-revoke) their own `user_sessions`; `app.check_session` checks the session row and version on each request. `admin_audit_log` is written only by `SECURITY DEFINER` triggers and admin functions and read only by admins.
- API tokens (`api_tokens`): users create, list and revoke their own; `kanban_app` cannot read `token_hash`. Requests resolve a token through `app.resolve_api_token(sha256)` (only `kanban_auth`). Webhooks (`board_webhooks`): owners only; the secret can be written but not read back. The outbox (`webhook_deliveries`) has no grants: a trigger on `card_activity` fills it and `kanban_auth` functions claim and finish deliveries.
- Card templates are cards with `is_template` set (fixed at creation); `app.copy_card(...)` copies cards to and from templates as the caller. Recurring schedules (`card_recurrences`): viewers read, editors manage; `app.run_due_recurrences()` (only `kanban_auth`) creates the cards as the schedule's last editor and switches the schedule off once they can no longer edit the board.

Policies for these live in `0012_card_features_rls.sql`, `0014_board_notify_copy.sql`, `0029_card_schedule_time_rls.sql`, `0031_watchers_links_rls.sql`, `0033_board_fields_rls.sql`, `0035_board_stars_archive_rls.sql`, `0037_card_templates_recurring_rls.sql`, `0039_two_factor_sessions_audit_rls.sql` and `0041_api_tokens_webhooks_rls.sql`.

### Live updates

Triggers on every board table send `NOTIFY board_changes` with the board id and the browser tab's id
(`x-client-id` header, stored in the transaction setting `app.client_id`). The payload holds no board data.
`GET /api/boards/:id/events` is a server-sent event stream: it sends `change` when someone else changed the
board, and the page refetches the board through RLS. Access is checked again before each event; the stream
sends `gone` and closes once the user loses access.

## Translations

UI text lives in `i18n/locales/<code>.json` (`@nuxtjs/i18n`, lazy-loaded, no URL prefixes). Components use
`useI18n().t('key')`; never hard-code UI text. To add a string, add the key to every locale file
(`tests/unit/i18n.test.ts` checks that all locales have the same keys and placeholders and that messages compile).
To add a locale, add its file, its entry in `nuxt.config.ts` (`i18n.locales`), `shared/i18n.ts` (`locales`), the
`users_locale_check` constraint and the Nuxt UI locale in `app/app.vue`. Emails and webhook messages are rendered on
the server from the same files (`server/utils/i18n.ts`).

## Schema changes

Edit `server/db/schema.ts`, then `pnpm db:generate` and `pnpm db:migrate`.
Add policies and grants for new tables in a custom migration (`pnpm drizzle-kit generate --custom`).
