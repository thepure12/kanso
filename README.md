<div align="center">

<img src="public/favicon.svg" alt="Kanso logo" width="72" height="72">

# Kanso

**Shared kanban boards where the database enforces every access rule.**

[![CI](https://github.com/thepure12/kanso/actions/workflows/ci.yml/badge.svg)](https://github.com/thepure12/kanso/actions/workflows/ci.yml)
![Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)
![Postgres 17](https://img.shields.io/badge/Postgres-17-4169E1?logo=postgresql&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)

[Features](#features) · [Quick start](#quick-start) · [Deployment](docs/DEPLOYMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Roadmap](docs/ROADMAP.md)

<sub>By PureApps</sub>

</div>

---

Kanso is a self-hosted kanban app for teams: boards, cards, calendars and timelines, live updates, webhooks and an
API, in English and German. It is built with Nuxt 4, Nuxt UI and Drizzle ORM on Postgres 17, and all permission logic
lives in Postgres row-level security policies. The app holds none of its own.

## Highlights

- 🔐 **Postgres owns authorization.** Three database roles, RLS on every table, identity set per transaction.
- ⚡ **Live collaboration.** Changes by others appear without a reload; undo with Ctrl/Cmd+Z.
- 🗂️ **Four views.** Board (with swimlanes), sortable list, month calendar and timeline.
- 🤖 **Automation.** Column rules, card templates, recurring cards, webhooks to Slack, Discord or any URL.
- 📱 **Installable.** A PWA with read-only offline access to the boards you opened.
- 🛡️ **Account security.** Two-factor auth, session management, email verification, rate limits, admin audit log.

## Features

<details open>
<summary><b>Boards and teams</b></summary>

- Share a board by email with a role:
  - **owner**: full control, manages members, renames and deletes the board
  - **editor**: creates, edits, moves and deletes columns and cards
  - **viewer**: read only
- **Teams** group people and boards. A team member's role applies to every board in the team. Team owners manage
  members and can rename or delete the team (which deletes its boards); team owners and editors create team boards.
  Guests can join a single team board. A person's effective role is the stronger of their team role and board role.
- Boards outside a team are personal: only people added to the board have access.
- Each team has a page with its boards and members: owners rename or delete the team and manage members and invites;
  anyone can leave.
- New boards start from a template (Basic, Scrum, Bug tracking, Empty). Copy a board with or without its cards.
- **Star** boards to put them first on the home page and in the command palette.
- **Archive** a board (owners): it becomes read-only for everyone and drops out of search, notifications and the digest.
- **Backgrounds and accent colours**: colours, gradients, stock photos or your own image, plus a per-board accent.
- The board's **Activity** feed shows every card change, newest first.

</details>

<details>
<summary><b>Cards</b></summary>

- Markdown description, card tags, several assignees, start and due date, priority, and an estimate in story points
  (summed in the column header).
- Checklists, comments with `@mentions`, file attachments up to 10 MB (stored in Postgres; an image can be the cover),
  time tracking (`1h30m`, `45m` or `1:30`) and an activity log.
- **Custom fields** per board: text, number, date, select (with colours), checkbox and link. Fields marked
  "show on cards" appear as chips on the board.
- **Link** cards: *blocks*, *relates to*, *duplicates*. A card shows **Blocked** while a blocker is still open
  (not archived and not in the last column). Blocking links cannot form a cycle.
- **Watch** a card to get the same notifications as its assignees. You watch cards you create or comment on.
- **Archive** cards to hide them; restore them from **Archived cards**.

</details>

<details>
<summary><b>Views, search and productivity</b></summary>

- **Views** (`?view=`, remembered per board): Board, sortable/groupable List with inline status change, month
  Calendar (drag a card to another day) and a read-only Timeline (week/month zoom).
- **Swimlanes** group the Board view by assignee, priority, card tag or a select field.
- **Filter** a board by text, card tag, assignee, priority, due date, start date and select/checkbox field values.
- **Command palette** (Ctrl/Cmd+K): search cards, comments, boards and columns across all your boards, jump to boards
  and run actions. Press **?** for keyboard shortcuts.
- **My work** (`g m`): the cards assigned to you or that you watch, grouped by due date.
- **Bulk actions**: Shift/Ctrl/Cmd+click cards to move, tag, assign, prioritise, date or archive them together.
- **Undo** moves, archiving, card and column edits, field values and deleted checklist items from the toast or with
  Ctrl/Cmd+Z (Ctrl/Cmd+Shift+Z redoes). Deleting a card asks first and offers to archive instead.

</details>

<details>
<summary><b>Automation and integrations</b></summary>

- **Column rules** run when a card enters a column: apply a card tag, remove a card tag, add an assignee, set the due date.
  Columns also have a colour and a soft WIP limit.
- **Board automations** run every hour: archive cards that have sat in the last column for N days, tag stale cards or
  notify their assignees and watchers, raise the priority of cards due within N days. They show up in the activity
  log as "Automation", so notifications and webhooks follow.
- **Card templates**: "Save as template" keeps a copy (description, card tags, checklist, estimate, priority, field values,
  optionally assignees). A template can **repeat** daily, weekly (chosen weekdays) or monthly, optionally with a due date.
- **Webhooks** (owners): send card activity as signed JSON, or as Slack or Discord messages. Retried with backoff,
  turned off after 20 failures in a row; only public addresses are reachable.
- **API tokens**: personal access tokens (`Authorization: Bearer kb_...`), read only or read and write, with an
  optional expiry. See [docs/API.md](docs/API.md).
- **Import** from a Kanso JSON export, a Trello board export or a CSV (Jira, spreadsheets), with a preview first.
  **Export** a board as JSON or its cards as CSV.
- **Notifications** in the app (live), as push notifications on phones and desktops even while Kanso is closed
  (per device, on the account page; needs https), plus an optional daily email digest.

</details>

<details>
<summary><b>Accounts, security and administration</b></summary>

- Sign in with email and password, Discord, GitHub or Google. Password sign-ups confirm their email.
- **Two-factor authentication**: TOTP from any authenticator app plus ten one-time recovery codes. Secrets are
  encrypted at rest (AES-256-GCM) with `NUXT_TOTP_KEY`, or a key derived from `NUXT_SESSION_PASSWORD`; changing that
  key makes existing secrets unreadable.
- **Sessions**: see every signed-in device and sign out one or all the others.
- Password reset by email; change name, email (confirmed by a link) and password; delete your account.
- Login, sign-up and password reset attempts are rate limited in Postgres, so limits hold across restarts and instances.
- **Admin page**: sign-up rules (open or restricted, allowed domains and emails, outside invites), admin promotion,
  user removal and an **audit log** of admin actions.
- **English and German**, following the browser until you pick one; the choice also sets the language of your emails
  and webhook messages.
- **Installable app (PWA)**: boards and cards you opened stay viewable offline, read-only. The offline copy is deleted
  on sign-out or when someone else signs in. Production builds only; service workers need HTTPS (or localhost).

</details>

## Quick start

Requires Node 22, pnpm and Docker (for Postgres).

```bash
pnpm install
cp .env.example .env          # set NUXT_SESSION_PASSWORD (32+ chars); OAuth keys optional
pnpm db:up                    # Postgres 17; docker/init.sql creates the roles
pnpm db:migrate               # runs as kanban_owner
pnpm dev                      # http://localhost:3000
```

Set `NUXT_ADMIN_EMAIL` to your email: a fresh install only lets that address (and invited people) sign up. Without
SMTP settings, the dev server logs email verification links to the console.

### Tests

```bash
pnpm test                               # everything
pnpm vitest run --project db            # RLS, triggers, SQL functions (needs the migrated database)
pnpm vitest run --project unit          # frontend helpers
pnpm vitest run --project components    # Vue components
pnpm vitest run --project api           # builds the app and calls its HTTP API (about 1.5 minutes)
pnpm typecheck
```

CI (`.github/workflows/ci.yml`) runs the migrations, the type check and all test projects against Postgres 17.

## Deployment

| Option | Best for |
| --- | --- |
| [`deploy/install.sh`](docs/DEPLOYMENT.md#install-script) | A Linux server: asks a few questions, then builds, migrates and starts Kanso as a systemd user service (no root) |
| [`docker compose --profile app up -d --build`](docs/DEPLOYMENT.md#docker-compose-local) | Trying it out locally |
| [`docker-compose.prod.yml`](docs/DEPLOYMENT.md#docker-compose-server) | A server, with optional Caddy for automatic HTTPS |
| [systemd, no Docker](docs/DEPLOYMENT.md#systemd-no-docker) | Your own Node 22, Postgres and reverse proxy |
| [systemd, no Docker, no Postgres install](docs/DEPLOYMENT.md#systemd-without-a-postgres-install) | A server with only Node 22: Postgres runs from an npm package (`deploy/embedded-pg/`) |

The app can also run [under a sub-path](docs/DEPLOYMENT.md#sub-path) such as `https://example.org/kanso/`.
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full guide, OAuth callback URLs and reverse proxy requirements.

## How it works

```
browser ──▶ Nuxt route handler ──▶ BEGIN; set_config('app.user_id', …, true)
                                    │
                                    ▼
                       Postgres (role kanban_app, NOBYPASSRLS)
                       RLS policies · SECURITY DEFINER helpers · triggers
                                    │
                    NOTIFY board_changes ──▶ SSE ──▶ other tabs refetch
```

| Role | Used by |
| --- | --- |
| `kanban_owner` | Migrations. Owns tables and `app.*` functions. |
| `kanban_app` | Every board, card and team request. Cannot bypass RLS or read credentials. |
| `kanban_auth` | Sign-in, registration, OAuth callbacks and scheduled tasks. |

Each request runs in a transaction that sets the user id locally, so pooled connections never carry an identity to
the next request. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the policies, live updates, translations and
schema changes.

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Docker, systemd, reverse proxy, sub-path, OAuth
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): database roles, RLS policies, live updates, translations
- [docs/API.md](docs/API.md): API tokens, routes and webhooks
- [docs/ROADMAP.md](docs/ROADMAP.md): planned features
