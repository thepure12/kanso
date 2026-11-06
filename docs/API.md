# Kanso HTTP API

Everything the web app does goes through the JSON API under `/api`. Scripts and integrations use it with a
**personal access token**. Postgres row-level security applies to token requests exactly as to the browser:
a token can see and do what its owner can, nothing more.

## Authentication

Create a token on the **Account** page (**API tokens**, **New token**). It is shown once; the server keeps only its
SHA-256. Send it as a Bearer token:

```bash
export KANSO=https://kanso.example.com
export TOKEN=kb_...
curl -H "Authorization: Bearer $TOKEN" $KANSO/api/boards
```

When the instance runs under a sub-path, include it in the base URL (`KANSO=https://example.org/kanso`).

- **Scopes**: *Read only* tokens may only send `GET` and `HEAD` (anything else is `403`). *Read and write* tokens may
  call every allowed route.
- **Allowed routes**: boards, cards, columns, tags, comments, checklist items, column rules, attachments, card links,
  fields, time entries, teams, notifications, search and `/api/me`. Account, sign-in, two-factor, session, token,
  admin and webhook routes refuse tokens (`403`, or `401` for routes that only take the session cookie), so a leaked
  token cannot take over the account.
- **Lifetime**: tokens work until revoked on the Account page, until they expire (30 days, 90 days, 1 year or never,
  chosen at creation), or until the account's password is **reset** through the forgot-password link. Changing the
  password while signed in, signing in elsewhere or turning on two-factor leaves them working. Deleting the account
  deletes them.
- Unknown, revoked and expired tokens get `401`. More than 20 failed token attempts from one IP within 15 minutes
  get `429`.
- A request with an `Authorization: Bearer` header is authenticated by the token only; cookies are ignored and none
  are set. No CSRF token is needed.

Errors come back as JSON with `statusCode` and `statusMessage`: `400` invalid input, `401` not authenticated,
`403` not allowed, `404` not found (or not visible to you), `409` conflict, `429` rate limited.

## Main routes

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/boards` | Boards you can see |
| POST | `/api/boards` | Create a board `{ name, teamId?, template? }` (`basic`, `scrum`, `bugs`, `empty`) |
| GET | `/api/boards/:id` | Board with columns, cards, tags, fields, members and your `role` |
| PATCH / DELETE | `/api/boards/:id` | Rename `{ name }` / delete (owners) |
| GET | `/api/boards/:id/export?format=json\|csv` | Export |
| GET | `/api/boards/:id/activity?before=&limit=` | Activity feed, newest first (cursor paginated) |
| POST | `/api/boards/:id/columns` | Add a column `{ title }` |
| PATCH / DELETE | `/api/columns/:id` | Edit / delete a column |
| POST | `/api/boards/:id/cards` | Add a card `{ columnId, title, description? }` |
| GET | `/api/cards/:id` | Card with checklist, comments, attachments, links and activity |
| PATCH | `/api/cards/:id` | Edit `{ title?, description?, startDate?, dueDate?, priority?, estimate?, tagIds?, assigneeIds?, archived? }` |
| POST | `/api/boards/:id/cards/bulk` | Change up to 200 cards at once, all or none `{ cardIds, columnId?, archived?, priority?, dueDate?, addTagIds?, removeTagIds?, addAssigneeIds?, removeAssigneeIds? }`; `columnId` moves them to the end of that column in board order. Returns `{ cards }` (those not archived) |
| POST | `/api/cards/:id/move` | Move `{ columnId, aboveId, belowId }` (neighbour card ids in the target column, `null` = start/end) |
| DELETE | `/api/cards/:id` | Delete a card |
| POST | `/api/cards/:id/comments` | Comment `{ body }` (Markdown) |
| POST | `/api/cards/:id/checklist` | Add a checklist item `{ text }` |
| POST | `/api/boards/:id/members` | Share `{ email, role }` (owners) |
| GET | `/api/teams`, `/api/teams/:id` | Teams and a team's boards and members |
| GET | `/api/search?q=` | Search cards, comments, boards and columns |
| GET | `/api/notifications` | Your notifications |
| GET | `/api/my-work` | Cards assigned to you or that you watch, on all boards (`assigned`, `watching`, `done` flags) |

Dates are `YYYY-MM-DD`; timestamps are ISO 8601. The types of responses live in `shared/types/`.

## Examples

```bash
# Boards and one board's cards
curl -s -H "Authorization: Bearer $TOKEN" $KANSO/api/boards
curl -s -H "Authorization: Bearer $TOKEN" $KANSO/api/boards/$BOARD | jq '.cards[] | {id, title}'

# Add a card to a column (needs a read and write token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"columnId":"'$COLUMN'","title":"Deploy 1.4"}' $KANSO/api/boards/$BOARD/cards

# Set its due date and move it to the end of another column
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"dueDate":"2026-11-01"}' $KANSO/api/cards/$CARD
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"columnId":"'$DONE'","aboveId":null,"belowId":null}' $KANSO/api/cards/$CARD/move
```

## Webhooks

Board owners add webhooks from the board menu (**Webhooks**). Each one gets the board's card activity (all kinds, or
the ones ticked: created, moved, renamed, commented, assigned, ...) as a `POST`:

- **JSON**: `{ event, deliveryId, text, activity: { id, kind, data, createdAt }, card: { id, title, url },
  board: { id, name, url }, actor: { id, name } }`. Signed: `X-Kanban-Timestamp` (Unix seconds) and
  `X-Kanban-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook's secret>`. The secret
  is shown once, when the webhook is added. Also sent: `X-Kanban-Event`, `X-Kanban-Delivery`. The test button sends
  `event: "ping"`.
- **Slack** (incoming webhook URL): `{ text }`. **Discord** (webhook URL): `{ content }`, mentions disabled.

Links point at `NUXT_PUBLIC_SITE_URL` (left out when it is not set). A delivery succeeds on any `2xx` within 5
seconds; redirects are not followed. Failures are retried after 1, 5 and 30 minutes and 2 hours (5 attempts), and a
webhook turns itself off after 20 failed attempts in a row. Webhooks only reach public addresses: private, loopback,
link-local and similar ranges are refused, checked on every connection (set `NUXT_WEBHOOK_ALLOW_PRIVATE=true` in
development to allow them). Archived boards send nothing.

Verifying a JSON delivery in Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(secret, headers, rawBody) {
  const ts = headers['x-kanban-timestamp']
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`
  const got = String(headers['x-kanban-signature'] ?? '')
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}
```
